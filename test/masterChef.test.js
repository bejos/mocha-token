const { expectRevert, time } = require('@openzeppelin/test-helpers');
const masterChefV2 = artifacts.require('MasterChefV2');

const MochaToken = artifacts.require('MochaToken');
const Mocktoken = artifacts.require('MockBEP20');
const BrewReferral = artifacts.require('BrewReferral');

// @NOTE TO RUN THESE TESTS create a flat MasterChefV2 file and put it inside /contracts
// Then change the `.sol` to `.txt` for `MasterChefV2.sol` and `MochaToken.sol` but 
// not the newly created flat file. ALSO in the flat file remove duplicate libraries
const addressZero = '0x0000000000000000000000000000000000000000';

contract('masterChefv2', ([alice, bob, carol, dev, minter, referrer, referred]) => {

    context('masterChef test', () => {
        beforeEach(async () => {

            this.mocha = await MochaToken.new(dev, minter, { from: minter });
            
            this.brewReferral = await BrewReferral.new({ from: referrer });
            this.lp1 = await Mocktoken.new({from: minter});
            this.lp2 = await Mocktoken.new({from: minter});

            await this.lp1.mint(alice,web3.utils.toWei('50'),{from: minter})
            await this.lp1.mint(bob,web3.utils.toWei('50'),{from: minter})
            await this.lp1.mint(carol,web3.utils.toWei('50'),{from: minter})

            await this.lp2.mint(alice,web3.utils.toWei('50'),{from: minter})
            await this.lp2.mint(bob,web3.utils.toWei('50'),{from: minter})
            await this.lp2.mint(carol,web3.utils.toWei('50'),{from: minter})         
        });

        it('should give out mochas only after farming time', async () => {
            // 1000 per block farming rate starting at block 100 
            
            this.masterChef = await masterChefV2.new(
                this.mocha.address,
                minter,
                minter,
                '1000',
                '100',
                { from: minter }
            );

            await this.brewReferral.updateOperator(this.masterChef.address, true, {from: referrer });
            await this.masterChef.setBrewReferral(this.brewReferral.address, {from: minter});

            await this.mocha.setWhiteListAccount(
                this.masterChef.address,
                true,
                { from: minter }
            )

            await this.mocha.transferOwnership(this.masterChef.address,{from:minter});

            await this.masterChef.add('100', this.lp1.address, 0,true,{from: minter});
            await this.lp1.approve(this.masterChef.address, '1000', { from: bob });
            await this.masterChef.deposit(0, '100', addressZero, { from: bob });
            await time.advanceBlockTo('89');
            
            await this.masterChef.deposit(0, '0', addressZero, { from: bob }); // block 90
            assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '0');
            
            await time.advanceBlockTo('94');
            await this.masterChef.deposit(0, '0', addressZero, { from: bob }); // block 95
            assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '0');
            
            await time.advanceBlockTo('99');
            await this.masterChef.deposit(0, '0', addressZero, { from: bob }); // block 100
            assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '0');
            
            await time.advanceBlockTo('100');
            await this.masterChef.deposit(0, '0', addressZero, { from: bob }); // block 101
            // 1000/10 = 100 To Dev, 1000-100 = 900 to Bob
            assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '900');
            assert.equal((await this.mocha.balanceOf(minter)).valueOf(), '100');
            assert.equal((await this.mocha.totalSupply()).valueOf(), '1000');
            await time.advanceBlockTo('104');
            await this.masterChef.deposit(0, '0', addressZero, { from: bob }); // block 105
            // 4000/10 = 400 to Dev, 4000-400 = 3600
            // 400 + 100 to Dev = 500, 3600+900 to Bob = 4500
            // Total supply is at 5000
            assert.equal((await this.mocha.balanceOf(minter)).valueOf(), '500');
            assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '4500');
            assert.equal((await this.mocha.totalSupply()).valueOf(), '5000');
        });

        it('should give proper mochas allocation to each pool and deduct 5% fee on rewards distribution ', async () => {
            this.masterChef = await masterChefV2.new(this.mocha.address,minter,minter,'1000','200',{from: minter});
            await this.mocha.setWhiteListAccount(this.masterChef.address,true,{from:minter})

            await this.mocha.transferOwnership(this.masterChef.address, { from: minter });
            await this.lp1.approve(this.masterChef.address, '1000', { from: alice });
            await this.lp2.approve(this.masterChef.address, '1000', { from: bob });
            // Add first LP to the pool with allocation 1
            await this.masterChef.add('10', this.lp1.address, 0,true, { from: minter });
            // Alice deposits 10 LPs at block 410
            await time.advanceBlockTo('209');
            await this.masterChef.deposit(0, '10', addressZero, { from: alice });
            // Add LP2 to the pool with allocation 2 at block 420
            await time.advanceBlockTo('219');
            await this.masterChef.add('20', this.lp2.address, 0,true, { from: minter });
            // Alice should have 10*1000 pending reward
            assert.equal((await this.masterChef.pendingBrew(0, alice)).valueOf(), '9000');
            // Bob deposits 10 LP2s at block 425
            await time.advanceBlockTo('224');
            await this.masterChef.deposit(1, '5', addressZero, { from: bob });
            assert.equal((await this.masterChef.pendingBrew(0, alice)).valueOf(), '10500');
            await time.advanceBlockTo('230');
            // At block 430. Bob should get 5*2/3*900.
            assert.equal((await this.masterChef.pendingBrew(1, bob)).valueOf(), '3000');
        });

        it('should distribute mochas properly for each staker', async () =>{
            // 100 per block farming rate starting at block 300 with bonus until block 1000
            this.masterChef = await masterChefV2.new(this.mocha.address, minter, minter,'1000', '300', { from: minter });
            await this.mocha.setWhiteListAccount(this.masterChef.address, true, { from: minter })

            await this.mocha.transferOwnership(this.masterChef.address, { from: minter });
            await this.masterChef.add('100', this.lp1.address, '0',true,{ from: minter });

            await this.lp1.approve(this.masterChef.address, '1000', { from: alice });
            await this.lp1.approve(this.masterChef.address, '1000', { from: bob });
            await this.lp1.approve(this.masterChef.address, '1000', { from: carol });

            // Alice deposits 10 LPs at block 310
            await time.advanceBlockTo('309');
            await this.masterChef.deposit(0, '10', addressZero, { from: alice });
            //  console.log(web3.utils.fromWei(await this.mocha.balanceOf(alice)));

            // Bob deposits 20 LPs at block 314
            await time.advanceBlockTo('313');
            await this.masterChef.deposit(0, '20', addressZero, { from: bob });
            // console.log(web3.utils.fromWei(await this.mocha.balanceOf(bob)));

            // Carol deposits 30 LPs at block 318
            await time.advanceBlockTo('317');
            await this.masterChef.deposit(0, '30', addressZero, { from: carol });
            // console.log(web3.utils.fromWei(await this.mocha.balanceOf(carol)));

            // Alice deposits 10 more LPs at block 320. At this point:
            await time.advanceBlockTo('319')
            await this.masterChef.deposit(0, '10', addressZero, { from: alice });
            // console.log(web3.utils.fromWei(await this.mocha.balanceOf(alice)));

            assert.equal((await this.masterChef.totalSupply()).valueOf(), '10000');
            assert.equal((await this.mocha.balanceOf(alice)).valueOf(), '5100');
            assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '0');
            assert.equal((await this.mocha.balanceOf(carol)).valueOf(), '0');
            assert.equal((await this.mocha.balanceOf(minter)).valueOf(), '1000');

            await time.advanceBlockTo('329')
            await this.masterChef.withdraw(0, '5', { from: bob });

            assert.equal((await this.masterChef.totalSupply()).valueOf(), '20000');
            assert.equal((await this.mocha.balanceOf(alice)).valueOf(), '5100');
            assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '5571');
            assert.equal((await this.mocha.balanceOf(carol)).valueOf(), '0');
            assert.equal((await this.mocha.balanceOf(minter)).valueOf(), '2000');
        
        });

        it('should distribute only 450k mochas  after it brewPerBlock becomes 0(no reward distribution)', async () => {
            this.masterChef = await masterChefV2.new(this.mocha.address, minter, minter,web3.utils.toWei('23000'), '400', { from: minter });
            await this.mocha.setWhiteListAccount(this.masterChef.address,true,{from:minter})

            await this.mocha.transferOwnership(this.masterChef.address, { from: minter });
            await this.masterChef.add('100', this.lp1.address, '0',true,{ from: minter });
            await this.lp1.approve(this.masterChef.address, '1000', { from: alice });
            await this.lp1.approve(this.masterChef.address, '1000', { from: bob });
            await this.lp1.approve(this.masterChef.address, '1000', { from: carol });
            // Alice deposits 10 LPs at block 310
            await time.advanceBlockTo('409');
            await this.masterChef.deposit(0, '10', addressZero, { from: alice });
            // Bob deposits 20 LPs at block 314
            await time.advanceBlockTo('413');
            await this.masterChef.deposit(0, '20', addressZero, { from: bob });
            // Carol deposits 30 LPs at block 318
            await time.advanceBlockTo('417');
            await this.masterChef.deposit(0, '30', addressZero, { from: carol });
            // Alice deposits 10 more LPs at block 320. At this point:
            //   Alice should have: (4*23000 + 4*1/3*23000 + 2*1/6*23000)*10/100
            await time.advanceBlockTo('419')
            await this.masterChef.deposit(0, '10', addressZero, { from: alice }); 111435
            assert.equal((await this.masterChef.totalSupply()).valueOf(), web3.utils.toWei('230000'));
            // console.log(web3.utils.fromWei(await this.mocha.balanceOf(alice)));
            assert.equal((await this.mocha.balanceOf(alice)).valueOf(),  web3.utils.toWei('117300'));
            assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '0');
            assert.equal((await this.mocha.balanceOf(carol)).valueOf(), '0');
            assert.equal((await this.mocha.balanceOf(minter)).valueOf(), web3.utils.toWei('23000'));

            await time.advanceBlockTo('900')
            await this.masterChef.withdraw(0, '5', { from: bob });
            // console.log(web3.utils.fromWei(await this.masterChef.totalSupply()).valueOf());

            assert.equal((await this.masterChef.totalSupply()).valueOf(), web3.utils.toWei('450000'));
            assert.equal((await this.mocha.balanceOf(carol)).valueOf(), '0');
            assert.equal((await this.mocha.balanceOf(minter)).valueOf(),  web3.utils.toWei('45000'));
            assert.equal((await this.masterChef.brewPerBlock()).valueOf(), '0');

            await time.advanceBlockTo('949')
            await this.masterChef.withdraw(0, '5', { from: bob });
            assert.equal((await this.masterChef.totalSupply()).valueOf(), web3.utils.toWei('450000'));
            assert.equal((await this.mocha.balanceOf(carol)).valueOf(), '0');
            assert.equal((await this.mocha.balanceOf(minter)).valueOf(),  web3.utils.toWei('45000'));
        });

        it('should allow emergency withdraw', async () => {
            this.masterChef = await masterChefV2.new(this.mocha.address, minter,minter, '100', '100',  { from: alice });
            await this.mocha.setWhiteListAccount(this.masterChef.address,true,{from:minter})

            await this.mocha.transferOwnership(this.masterChef.address, { from: minter });
            await this.masterChef.add('100', this.lp1.address, 0,true);
            await this.lp1.approve(this.masterChef.address, web3.utils.toWei('50'), { from: bob });
            await this.masterChef.deposit(0, web3.utils.toWei('40'), addressZero, { from: bob });
            assert.equal((await this.lp1.balanceOf(bob)).valueOf(), web3.utils.toWei('10'));
            await this.masterChef.emergencyWithdraw(0, { from: bob });
            assert.equal((await this.lp1.balanceOf(bob)).valueOf(), web3.utils.toWei('50'));
        });

        it('should deduct deposit fee on each deposit ', async () => {
            this.masterChef = await masterChefV2.new(this.mocha.address, minter,minter, '100', '100',  { from: alice });
            await this.mocha.setWhiteListAccount(this.masterChef.address,true,{from:minter})

            await this.mocha.transferOwnership(this.masterChef.address, { from: minter });
            await this.masterChef.add('100', this.lp1.address, 500,true);
            await this.lp1.approve(this.masterChef.address, web3.utils.toWei('60'), { from: bob });
            await this.masterChef.deposit(0, web3.utils.toWei('40'), addressZero, { from: bob });
            
            assert.equal((await this.lp1.balanceOf(bob)).valueOf(), web3.utils.toWei('10'));
            await this.masterChef.deposit(0, web3.utils.toWei('10'), addressZero, { from: bob });

            await this.masterChef.emergencyWithdraw(0, { from: bob });
            assert.equal((await this.lp1.balanceOf(bob)).valueOf(), web3.utils.toWei('47.5'));
        });

        it('should set correct state variables', async () => {
            this.masterChef = await masterChefV2.new(this.mocha.address, dev,dev, '1000', '1000', { from: alice });
            await this.mocha.transferOwnership(this.masterChef.address, { from: minter });
            const brew = await this.masterChef.brew();
            const devaddr = await this.masterChef.devaddr();
            const owner = await this.mocha.owner();
            assert.equal(brew.valueOf(), this.mocha.address);
            assert.equal(devaddr.valueOf(), dev);
            assert.equal(owner.valueOf(), this.masterChef.address);
        });

        it('should allow dev and only dev to update dev', async () => {
            this.masterChef = await masterChefV2.new(this.mocha.address, dev,dev, '1000', '1000', { from: alice });
            assert.equal((await this.masterChef.devaddr()).valueOf(), dev);
            await expectRevert(this.masterChef.dev(bob, { from: bob }), 'dev: wut?');
            await this.masterChef.dev(bob, { from: dev });
            assert.equal((await this.masterChef.devaddr()).valueOf(), bob);
            await this.masterChef.dev(alice, { from: bob });
            assert.equal((await this.masterChef.devaddr()).valueOf(), alice);
        })

        it('should allow feeAddress and only feeAddress to update feeAddress', async () => {
            this.masterChef = await masterChefV2.new(this.mocha.address, dev,minter, '1000', '1000', { from: alice });
            assert.equal((await this.masterChef.feeAddress()).valueOf(), minter);
            await expectRevert(this.masterChef.setFeeAddress(bob, { from: bob }), "setFeeAddress: FORBIDDEN");
            await this.masterChef.setFeeAddress(bob, { from: minter });
            assert.equal((await this.masterChef.feeAddress()).valueOf(), bob);
            await this.masterChef.setFeeAddress(alice, { from: bob });
            assert.equal((await this.masterChef.feeAddress()).valueOf(), alice);
        })

        it('should allow owner and only owner to update updateEmissionRate revert if emissionRate is more than 1', async () => {
            this.masterChef = await masterChefV2.new(this.mocha.address, dev,minter, '1000', '1000', { from: alice });
            assert.equal((await this.masterChef.brewPerBlock()).valueOf(), '1000');
            await expectRevert(this.masterChef.updateEmissionRate("100", { from: bob }), "Ownable: caller is not the owner.");
            await this.masterChef.updateEmissionRate('900', { from: alice });
            assert.equal((await this.masterChef.brewPerBlock()).valueOf(), '900');
            await expectRevert(this.masterChef.updateEmissionRate(web3.utils.toWei('1.1'), { from: alice }), "invalid brewPerBlock");
            
        })

        it('should allow owner and only owner to update poolInfo and revert for non existing pool', async () => {
            this.masterChef = await masterChefV2.new(this.mocha.address, dev,minter, '1000', '1000', { from: alice });
            await expectRevert(this.masterChef.add('100', this.lp1.address, 0,true, { from: bob }), "Ownable: caller is not the owner");
            await expectRevert(this.masterChef.add('100', this.lp1.address, 600,true, { from: alice }), "add: invalid deposit fee basis points");

            await this.masterChef.add('100', this.lp1.address, 0,true);
            await expectRevert(this.masterChef.add('100', this.lp1.address, 0,true, { from: alice }), "nonDuplicated: duplicated");
            await expectRevert(this.masterChef.set(1,'100', 0,true, { from: alice }), "isPoolExist: pool not exist");
            await expectRevert(this.masterChef.set(0,'100', 600,true, { from: alice }), "set: invalid deposit fee basis points");

            await this.masterChef.set(0,'1000',0,true);
            
        })

        // Referral Tests with regards to BrewReferral

        it('It should take a commission if a referral is set', async () => {
          // 1000 per block farming rate starting at block 100 
          this.masterChef = await masterChefV2.new(
              this.mocha.address,
              minter,
              minter,
              '1000',
              '2100',
              { from: minter }
          );

          await this.brewReferral.updateOperator(this.masterChef.address, true, {from: referrer });
          await this.masterChef.setBrewReferral(this.brewReferral.address, {from: minter});

          await this.mocha.setWhiteListAccount(
              this.masterChef.address,
              true,
              { from: minter }
          )

          await this.mocha.transferOwnership(this.masterChef.address,{ from: minter });

          await this.masterChef.add('100', this.lp1.address, 0, true, {from: minter});
          await this.lp1.approve(this.masterChef.address, '1000', { from: bob });
          await this.masterChef.deposit(0, '100', alice, { from: bob });
          await time.advanceBlockTo('2089');

          await this.masterChef.deposit(0, '0', alice, { from: bob }); // block 90
          assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '0');

          await time.advanceBlockTo('2094');
          await this.masterChef.deposit(0, '0', alice, { from: bob }); // block 95
          assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '0');

          await time.advanceBlockTo('2099');
          await this.masterChef.deposit(0, '0', alice, { from: bob }); // block 100
          assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '0');

          await time.advanceBlockTo('2100');
          await this.masterChef.deposit(0, '0', alice, { from: bob }); // block 101

          // 1000/10 = 100 To Dev, 1000-100 = 900 to Bob
          assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '891');
          assert.equal((await this.mocha.balanceOf(alice)).valueOf(), '9');
          assert.equal((await this.mocha.balanceOf(minter)).valueOf(), '100');
          assert.equal((await this.mocha.totalSupply()).valueOf(), '1000');
          await time.advanceBlockTo('2104');
          await this.masterChef.deposit(0, '0', alice, { from: bob }); // block 105
          // 4000/10 = 400 to Dev, 4000-400 = 3600 - Commission = 3564
          // 400 + 100 to Dev = 500, 3564+891 to Bob = 4500
          // Total supply is at 5000
          assert.equal((await this.mocha.balanceOf(minter)).valueOf(), '500');
          assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '4455');
          assert.equal((await this.mocha.balanceOf(alice)).valueOf(), '45');
          assert.equal((await this.mocha.totalSupply()).valueOf(), '5000');
      });

      it('It should take a commission if a referral is set once, and all other deposits are using address(0)', async () => {
        // 1000 per block farming rate starting at block 100 
        this.masterChef = await masterChefV2.new(
            this.mocha.address,
            minter,
            minter,
            '1000',
            '3100',
            { from: minter }
        );

        await this.brewReferral.updateOperator(this.masterChef.address, true, {from: referrer });
        await this.masterChef.setBrewReferral(this.brewReferral.address, {from: minter});

        await this.mocha.setWhiteListAccount(
            this.masterChef.address,
            true,
            { from: minter }
        )

        await this.mocha.transferOwnership(this.masterChef.address,{ from: minter });

        await this.masterChef.add('100', this.lp1.address, 0, true, {from: minter});
        await this.lp1.approve(this.masterChef.address, '1000', { from: bob });
        await this.masterChef.deposit(0, '100', alice, { from: bob });
        await time.advanceBlockTo('3089');

        await this.masterChef.deposit(0, '0', addressZero, { from: bob }); // block 90
        assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '0');

        await time.advanceBlockTo('3094');
        await this.masterChef.deposit(0, '0', addressZero, { from: bob }); // block 95
        assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '0');

        await time.advanceBlockTo('3099');
        await this.masterChef.deposit(0, '0', addressZero, { from: bob }); // block 100
        assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '0');

        await time.advanceBlockTo('3100');
        await this.masterChef.deposit(0, '0', addressZero, { from: bob }); // block 101

        // 1000/10 = 100 To Dev, 1000-100 = 900 to Bob
        assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '891');
        assert.equal((await this.mocha.balanceOf(alice)).valueOf(), '9');
        assert.equal((await this.mocha.balanceOf(minter)).valueOf(), '100');
        assert.equal((await this.mocha.totalSupply()).valueOf(), '1000');
        await time.advanceBlockTo('3104');
        await this.masterChef.deposit(0, '0', addressZero, { from: bob }); // block 105
        // 4000/10 = 400 to Dev, 4000-400 = 3600 - Commission = 3564
        // 400 + 100 to Dev = 500, 3564+891 to Bob = 4500
        // Total supply is at 5000
        assert.equal((await this.mocha.balanceOf(minter)).valueOf(), '500');
        assert.equal((await this.mocha.balanceOf(bob)).valueOf(), '4455');
        assert.equal((await this.mocha.balanceOf(alice)).valueOf(), '45');
        assert.equal((await this.mocha.totalSupply()).valueOf(), '5000');
    });

    it('It should not create a referral if referral is address(0) || msg.sender || amount = 0', async () => {
        // 1000 per block farming rate starting at block 100 
        this.masterChef = await masterChefV2.new(
            this.mocha.address,
            minter,
            minter,
            '1000',
            '3100',
            { from: minter }
        );

        await this.brewReferral.updateOperator(this.masterChef.address, true, {from: referrer });
        await this.masterChef.setBrewReferral(this.brewReferral.address, {from: minter});

        await this.mocha.setWhiteListAccount(
            this.masterChef.address,
            true,
            { from: minter }
        )

        await this.mocha.transferOwnership(this.masterChef.address,{ from: minter });

        await this.masterChef.add('100', this.lp1.address, 0, true, {from: minter});
        await this.lp1.approve(this.masterChef.address, '1000', { from: bob });
        
        // Check if addressZero is default address
        await this.masterChef.deposit(0, '10', addressZero, { from: bob });
        assert.equal(await this.brewReferral.getReferrer(bob, { from: bob }), addressZero)
        
        // Check if addressZero is still referrer even if bob sets it as himself
        await this.masterChef.deposit(0, '10', bob, { from: bob });
        assert.equal(await this.brewReferral.getReferrer(bob, { from: bob }), addressZero)

        // Check if addressZero is still referrer even if bob sets it as alice but amount = 0
        await this.masterChef.deposit(0, '0', alice, { from: bob });
        assert.equal(await this.brewReferral.getReferrer(bob, { from: bob }), addressZero)


        // Check if it's alice on correct set
        await this.masterChef.deposit(0, '10', alice, { from: bob });
        assert.equal(await this.brewReferral.getReferrer(bob, { from: bob }), alice)

        // Check if you can overwrite referral, you shouldn't be able to!
        await this.masterChef.deposit(0, '10', carol, { from: bob });
        assert.equal(await this.brewReferral.getReferrer(bob, { from: bob }), alice)

    });

    });
});

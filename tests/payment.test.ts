import { describe, expect, it } from "@jest/globals";
import { accountBalanceMina, initBlockchain } from "zkcloudworker";
import { PrivateKey, Mina, AccountUpdate } from "o1js";

const AMOUNT = 10_000_000_000n;

describe("Payment", () => {
  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);
  const deployer = Local.testAccounts[0].privateKey;
  const sender = deployer.toPublicKey();

  it(`should send zkApp payments to 2 addresses`, async () => {
    const receiver1 = PrivateKey.random().toPublicKey();
    const receiver2 = PrivateKey.random().toPublicKey();
    const transaction = await Mina.transaction(
      { sender, fee: "100000000", memo: "domain name service tx1" },
      async () => {
        AccountUpdate.fundNewAccount(sender, 2);
        const senderUpdate1 = AccountUpdate.create(sender);
        senderUpdate1.requireSignature();
        senderUpdate1.send({ to: receiver1, amount: AMOUNT });
        senderUpdate1.send({ to: receiver2, amount: AMOUNT });
      }
    );
    await transaction.prove();
    await transaction.sign([deployer]).send();
    console.log(
      "balance of the receiver1:",
      await accountBalanceMina(receiver1)
    );
    console.log(
      "balance of the receiver2:",
      await accountBalanceMina(receiver2)
    );
  });

  it(`should send non-zkApp payments to 1 address`, async () => {
    const Local = Mina.LocalBlockchain();
    Mina.setActiveInstance(Local);
    const deployer = Local.testAccounts[0].privateKey;
    const sender = deployer.toPublicKey();
    const receiver = PrivateKey.random().toPublicKey();
    const transaction = await Mina.transaction(
      { sender, fee: "100000000", memo: "payment" },
      async () => {
        const senderUpdate = AccountUpdate.createSigned(sender);
        senderUpdate.balance.subInPlace(1000000000);
        senderUpdate.send({ to: receiver, amount: AMOUNT });
      }
    );
    await transaction.sign([deployer]).send();
    console.log("balance of the receiver:", await accountBalanceMina(receiver));
  });

  it(`should send non-zkApp payments to 2 addresses`, async () => {
    const Local = Mina.LocalBlockchain();
    Mina.setActiveInstance(Local);
    const deployer = Local.testAccounts[0].privateKey;
    const sender = deployer.toPublicKey();
    const receiver1 = PrivateKey.random().toPublicKey();
    const receiver2 = PrivateKey.random().toPublicKey();
    const transaction = await Mina.transaction(
      { sender, fee: "100000000", memo: "domain name service tx2" },
      async () => {
        const senderUpdate1 = AccountUpdate.createSigned(sender);
        senderUpdate1.balance.subInPlace(2000000000);
        senderUpdate1.send({ to: receiver1, amount: AMOUNT });
        senderUpdate1.send({ to: receiver2, amount: AMOUNT });
      }
    );
    await transaction.sign([deployer]).send();
    console.log(
      "balance of the receiver1:",
      await accountBalanceMina(receiver1)
    );
    console.log(
      "balance of the receiver2:",
      await accountBalanceMina(receiver2)
    );
  });

  it(`should send 2 non-zkApp payment to 2 addresses`, async () => {
    const Local = Mina.LocalBlockchain();
    Mina.setActiveInstance(Local);
    const deployer1 = Local.testAccounts[1].privateKey;
    const deployer2 = Local.testAccounts[2].privateKey;
    const sender1 = deployer1.toPublicKey();
    const sender2 = deployer2.toPublicKey();
    const receiver1 = PrivateKey.random().toPublicKey();
    const receiver2 = PrivateKey.random().toPublicKey();
    console.log("balance of the sender1:", await accountBalanceMina(sender1));
    console.log("balance of the sender2:", await accountBalanceMina(sender2));
    const transaction = await Mina.transaction(
      { sender: sender1, fee: "100000000", memo: "domain name service tx3" },
      async () => {
        const senderUpdate1 = AccountUpdate.createSigned(sender1);
        senderUpdate1.balance.subInPlace(1000000000);
        senderUpdate1.send({ to: receiver1, amount: AMOUNT });
        const senderUpdate2 = AccountUpdate.createSigned(sender2);
        senderUpdate2.send({ to: receiver1, amount: AMOUNT });
      }
    );
    await transaction.sign([deployer1, deployer2]).send();
    console.log(
      "balance of the receiver1:",
      await accountBalanceMina(receiver1)
    );
    console.log(
      "balance of the receiver2:",
      await accountBalanceMina(receiver2)
    );
  });
});

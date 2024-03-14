import { describe, expect, it } from "@jest/globals";
import { accountBalanceMina, initBlockchain } from "zkcloudworker";
import { PrivateKey, Mina, AccountUpdate } from "o1js";

const useLocal = true;
const AMOUNT = 1_000_000_000n;

describe("Payment", () => {
  it(`should send zkApp payments to 2 addresses`, async () => {
    const deployer = initBlockchain(useLocal ? "local" : "berkeley", 1).keys[0]
      .privateKey;
    const sender = deployer.toPublicKey();
    const receiver1 = PrivateKey.random().toPublicKey();
    const receiver2 = PrivateKey.random().toPublicKey();
    const transaction = await Mina.transaction(
      { sender, fee: "100000000", memo: "domain name service tx1" },
      () => {
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
  it(`should send non-zkApp payments to 2 addresses`, async () => {
    const Local = Mina.LocalBlockchain();
    Mina.setActiveInstance(Local);
    const deployer = Local.testAccounts[0].privateKey;
    const sender = deployer.toPublicKey();
    const receiver1 = PrivateKey.random().toPublicKey();
    const receiver2 = PrivateKey.random().toPublicKey();
    const transaction = await Mina.transaction(
      { sender, fee: "100000000", memo: "domain name service tx2" },
      () => {
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
});

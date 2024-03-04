import { describe, expect, it } from "@jest/globals";
import { accountBalanceMina } from "zkcloudworker";
import { PrivateKey, Mina, AccountUpdate } from "o1js";

const AMOUNT = 10_000_000_000n;

describe("Payment", () => {
  it(`should send payments to 2 addresses`, async () => {
    const Local = Mina.LocalBlockchain();
    Mina.setActiveInstance(Local);
    const deployer = Local.testAccounts[0].privateKey;
    const sender = deployer.toPublicKey();
    const receiver1 = PrivateKey.random().toPublicKey();
    const receiver2 = PrivateKey.random().toPublicKey();
    const transaction = await Mina.transaction(
      { sender, fee: "100000000", memo: "domain name service" },
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
});

import { describe, expect, it } from "@jest/globals";
import { accountBalanceMina, initBlockchain, sleep } from "zkcloudworker";
import {
  PrivateKey,
  Mina,
  AccountUpdate,
  PublicKey,
  fetchAccount,
  Account,
} from "o1js";
import { blockProducer } from "../../src/config";

const AMOUNT = 290_000_000_000n;
const privateKey = //PrivateKey.random();
  PrivateKey.fromBase58("EKEuW2oY1Jab9eMVAmHMU9s8X4Kqnp6vXeyhqKvhwKcd83Pk2szf");

describe("Payment", () => {
  it(`should send non-zkApp payments to 1 address`, async () => {
    const networkInstance = Mina.Network({
      mina: "https://proxy.devnet.minaexplorer.com/graphql",
    });
    Mina.setActiveInstance(networkInstance);
    const sender = privateKey.toPublicKey();

    console.log({
      sender: sender.toBase58(),
      privateKey: privateKey.toBase58(),
    });

    await fetchAccount({ publicKey: sender });
    const receiver = blockProducer.publicKey;
    await fetchAccount({ publicKey: receiver });
    const balance = await accountBalanceMina(sender);
    console.log("initial balance of the sender:", balance);

    console.log(
      "initial balance of the receiver:",
      await accountBalanceMina(receiver)
    );
    if (balance < 291) return;

    const transaction = await Mina.transaction(
      { sender, fee: "100000000", memo: "topup" },
      async () => {
        const senderUpdate = AccountUpdate.createSigned(sender);
        senderUpdate.send({ to: receiver, amount: AMOUNT });
      }
    );
    const txSent = await transaction.sign([privateKey]).send();
    console.log({ txSent });
    const txIncluded = await txSent.wait();
    console.log({ txIncluded });
    await sleep(10000);
    console.log(
      "final balance of the receiver:",
      await accountBalanceMina(receiver)
    );
  });
});

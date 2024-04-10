import { describe, expect, it } from "@jest/globals";
import { accountBalanceMina, initBlockchain } from "zkcloudworker";
import { PublicKey, Mina } from "o1js";

const endpoint = "https://proxy.devnet.minaexplorer.com/graphql";

describe("Balance", () => {
  it(`should get the balance`, async () => {
    //initBlockchain("devnet");
    const networkInstance = Mina.Network({
      mina: endpoint,
    });
    Mina.setActiveInstance(networkInstance);
    const receiver1 = PublicKey.fromBase58(
      "B62qoUR5QuY1A19PwK3xBNKYkW4iPVNxfBTmU1TPQutgRu4gqBvDFST"
    );
    const receiver2 = PublicKey.fromBase58(
      "B62qiTrtDyWmDFMQvUDRUdWVsVwNFhUV4rkPVgeANi4adKhrUwfdNFT"
    );

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

import { describe, expect, it } from "@jest/globals";
import {
  Field,
  PrivateKey,
  Mina,
  Reducer,
  AccountUpdate,
  fetchAccount,
  MerkleMap,
} from "o1js";
import { initBlockchain, fee, accountBalanceMina } from "zkcloudworker";
import { DomainNameContract } from "../../contract/domain-contract";
import { MapUpdate } from "../../rollup/transaction";
import { nameContract, deployer as berkeleyDeployer } from "../../config";

const useLocalBlockchain = true;
const ownerPublicKey = nameContract.ownerPrivateKey.toPublicKey();

describe("Deploy Base Contract", () => {
  it(`should compile contract`, async () => {
    console.time("compiled");
    await MapUpdate.compile();
    await DomainNameContract.compile();
    console.timeEnd("compiled");
  });

  it("should deploy the contract", async () => {
    let deployer: PrivateKey | undefined = undefined;
    if (useLocalBlockchain) {
      const Local = Mina.LocalBlockchain();
      Mina.setActiveInstance(Local);
      deployer = Local.testAccounts[0].privateKey;
    } else {
      initBlockchain("berkeley");
      deployer = berkeleyDeployer;
    }
    const sender = deployer.toPublicKey();
    const privateKey = nameContract.contractPrivateKey;
    const publicKey = privateKey.toPublicKey();
    const zkApp = new DomainNameContract(publicKey);
    console.log("zkApp address:", publicKey.toBase58());
    expect(deployer).toBeDefined();
    expect(sender).toBeDefined();
    if (deployer === undefined || sender === undefined) return;
    await fetchAccount({ publicKey: sender });
    const balance = await accountBalanceMina(sender);
    console.log("balance", balance);
    expect(balance).toBeGreaterThan(0);
    if (balance === 0) return;
    const map = new MerkleMap();
    const root = map.getRoot();
    const tx = await Mina.transaction({ sender, fee: await fee() }, () => {
      AccountUpdate.fundNewAccount(sender);
      zkApp.deploy({});
      zkApp.account.zkappUri.set("https://MinaNameService.zkCloudWorker.com");
      zkApp.domain.set(Field(0));
      zkApp.root.set(root);
      zkApp.actionState.set(Reducer.initialActionState);
      zkApp.count.set(Field(0));
      zkApp.owner.set(ownerPublicKey);
    });
    const txResult = await tx.sign([deployer, privateKey]).send();
    console.log("tx sent:", txResult.hash());
  });
});

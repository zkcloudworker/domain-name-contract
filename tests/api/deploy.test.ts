import { describe, expect, it } from "@jest/globals";
import {
  PrivateKey,
  setNumberOfWorkers,
  Mina,
  AccountUpdate,
  VerificationKey,
  PublicKey,
  fetchAccount,
  Cache,
} from "o1js";
import {
  DomainNameContract,
  BlockContract,
} from "../../src/contract/domain-contract";
import { ValidatorsVoting } from "../../src/rollup/validators";
import { getValidatorsTreeAndHash } from "../../src/rollup/validators-proof";
import { nameContract } from "../../src/config";
import {
  initBlockchain,
  blockchain,
  accountBalanceMina,
  Memory,
  sleep,
} from "zkcloudworker";
import { MapUpdate } from "../../src/rollup/transaction";
import { DEPLOYER } from "../../env.json";

setNumberOfWorkers(6);
const network: blockchain = "devnet";
const fee = "100000000";

let deployer: PrivateKey;
let sender: PublicKey;

const { tree, totalHash } = getValidatorsTreeAndHash();
const validatorsRoot = tree.getRoot();
const contractPrivateKey = nameContract.contractPrivateKey;
const contractPublicKey = contractPrivateKey.toPublicKey();

const zkApp = new DomainNameContract(contractPublicKey);
let verificationKey: VerificationKey;
let blockVerificationKey: VerificationKey;
let mapVerificationKey: VerificationKey;
let contractVerificationKey: VerificationKey;

describe("Domain Name Service Contract", () => {
  it(`should compile and deploy contract`, async () => {
    await initBlockchain(network);
    deployer = PrivateKey.fromBase58(DEPLOYER);
    sender = deployer.toPublicKey();

    const networkId = Mina.getNetworkId();
    console.log("Network ID:", networkId);
    console.log("sender", sender.toBase58());
    console.log("Sender balance", await accountBalanceMina(sender));
    expect(deployer).toBeDefined();
    expect(sender).toBeDefined();
    expect(deployer.toPublicKey().toBase58()).toBe(sender.toBase58());

    console.time("compiled");
    console.log("Compiling contracts...");
    const cache: Cache = Cache.FileSystem("./cache");
    mapVerificationKey = (await MapUpdate.compile({ cache })).verificationKey;
    verificationKey = (await ValidatorsVoting.compile({ cache }))
      .verificationKey;
    blockVerificationKey = (await BlockContract.compile({ cache }))
      .verificationKey;
    contractVerificationKey = (await DomainNameContract.compile({ cache }))
      .verificationKey;
    console.timeEnd("compiled");
    console.log(
      "contract verification key",
      contractVerificationKey.hash.toJSON()
    );
    console.log("block verification key", blockVerificationKey.hash.toJSON());
  });

  it.skip(`should deploy contract`, async () => {
    await fetchAccount({ publicKey: sender });

    const tx = await Mina.transaction(
      { sender, fee, memo: "deploy" },
      async () => {
        AccountUpdate.fundNewAccount(sender);
        await zkApp.deploy({});
        zkApp.validators.set(validatorsRoot);
        zkApp.validatorsHash.set(totalHash);
        zkApp.account.zkappUri.set("https://zkcloudworker.com");
      }
    );

    const txSent = await tx.sign([deployer, contractPrivateKey]).send();
    console.log({ txSent });
    const txIncluded = await txSent.wait();
    console.log({ txIncluded });
    await sleep(20000);

    await fetchAccount({ publicKey: sender });
    await fetchAccount({ publicKey: contractPublicKey });
    const tx2 = await Mina.transaction(
      { sender, fee, memo: "block 0" },
      async () => {
        AccountUpdate.fundNewAccount(sender);
        await zkApp.firstBlock(nameContract.firstBlockPublicKey!);
      }
    );
    await tx2.prove();
    const txSent2 = await tx2
      .sign([deployer, nameContract.firstBlockPrivateKey!])
      .send();
    console.log({ txSent2 });
    const txIncluded2 = await txSent2.wait();
    console.log({ txIncluded2 });
    Memory.info("deployed");
  });
});

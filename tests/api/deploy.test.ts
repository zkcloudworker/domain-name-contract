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
  Encoding,
  UInt64,
} from "o1js";
import {
  DomainNameContract,
  BlockContract,
} from "../../src/contract/domain-contract";
import { ValidatorsVoting } from "../../src/rollup/validators";
import { getValidators } from "../../src/rollup/validators-proof";
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

setNumberOfWorkers(8);
const chain: blockchain = "zeko";
const fee = "100000000";

let deployer: PrivateKey;
let sender: PublicKey;

const { validators, tree } = getValidators(0);
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
    await initBlockchain(chain);
    deployer = PrivateKey.fromBase58(DEPLOYER);
    sender = deployer.toPublicKey();

    const networkId = Mina.getNetworkId();
    console.log("Network:", chain);
    console.log("Network ID:", networkId);
    console.log("Contract address:", contractPublicKey.toBase58());
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

  it(`should deploy contract`, async () => {
    await fetchAccount({ publicKey: sender });

    const tx = await Mina.transaction(
      { sender, fee, memo: "deploy" },
      async () => {
        AccountUpdate.fundNewAccount(sender);
        await zkApp.deploy({});
        zkApp.validatorsPacked.set(validators.pack());
        zkApp.domain.set(Encoding.stringToFields("mina")[0]);
        zkApp.account.zkappUri.set("https://names.minascan.io");
      }
    );

    const txSent = await tx.sign([deployer, contractPrivateKey]).safeSend();
    console.log({ txSent });
    if (chain !== "zeko" && txSent.status === "pending") {
      const txIncluded = await txSent.safeWait();
      console.log({ txIncluded });
    }

    await sleep(20000);

    await fetchAccount({ publicKey: sender });
    await fetchAccount({ publicKey: contractPublicKey });
    const tx2 = await Mina.transaction(
      { sender, fee, memo: "block 0" },
      async () => {
        AccountUpdate.fundNewAccount(sender);
        await zkApp.blockZero(
          nameContract.firstBlockPublicKey!,
          UInt64.from(Date.now())
        );
      }
    );
    await tx2.prove();
    const txSent2 = await tx2
      .sign([deployer, nameContract.firstBlockPrivateKey!])
      .safeSend();
    console.log({ txSent2 });
    if (chain !== "zeko" && txSent2.status === "pending") {
      const txIncluded = await txSent2.safeWait();
      console.log({ txIncluded });
    }
    Memory.info("deployed");
  });
});

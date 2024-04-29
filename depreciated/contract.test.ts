import { describe, expect, it } from "@jest/globals";
import {
  Field,
  PrivateKey,
  setNumberOfWorkers,
  Mina,
  AccountUpdate,
  VerificationKey,
  UInt64,
  Cache,
  PublicKey,
  Encoding,
  verify,
  fetchAccount,
} from "o1js";
import {
  ValidatorsVoting,
  ValidatorsDecision,
  ValidatorDecisionType,
  ValidatorsVotingProof,
} from "../src/rollup/validators";
import {
  DomainNameContract,
  BlockContract,
  ChangeValidatorsData,
} from "../src/contract/domain-contract";
import { getValidators } from "../src/rollup/validators-proof";
import { Storage } from "../src/contract/storage";
import { nameContract, JWT, blockProducer } from "../src/config";
import {
  zkCloudWorkerClient,
  blockchain,
  sleep,
  LocalCloud,
  Memory,
  fetchMinaAccount,
  fee,
  initBlockchain,
  getNetworkIdHash,
} from "zkcloudworker";
import { MapUpdate } from "../src/rollup/transaction";
import { calculateValidatorsProof } from "../src/rollup/validators-proof";
import { zkcloudworker } from "../src/worker"; //, setVerificationKey
import { DEPLOYER, PINATA_JWT } from "../env.json";
import { uniqueNamesGenerator, names } from "unique-names-generator";

setNumberOfWorkers(8);
const chain: blockchain = "local" as blockchain;
const deploy = true;
const useLocalCloudWorker = true;
const api = new zkCloudWorkerClient({
  jwt: useLocalCloudWorker ? "local" : JWT,
  zkcloudworker,
  chain,
});

let deployer: PrivateKey;
let sender: PublicKey;
const ELEMENTS_NUMBER = 1;
const BLOCKS_NUMBER = 1;
const domainNames: string[][] = [];

const { validators, tree } = getValidators(0);

const contractPrivateKey = PrivateKey.random(); //nameContract.contractPrivateKey;
const contractPublicKey = contractPrivateKey.toPublicKey();
//PublicKey.fromBase58(
//  "B62qiu5ZzyjYqauNFgxybax6buGNH9V9DhWtKPrYPQCB6FpZe5VBpE6"
//); // contractPrivateKey.toPublicKey();

const zkApp = new DomainNameContract(contractPublicKey);
let blockVerificationKey: VerificationKey;
let validatorsVerificationKey: VerificationKey;
let mapVerificationKey: VerificationKey;
let contractVerificationKey: VerificationKey;
const tokenId: Field = zkApp.deriveTokenId();

type DomainTransactionType = "add" | "extend" | "update" | "remove";
interface TransactionJSON {
  operation: DomainTransactionType;
  name: string;
  address: string;
  expiry: number;
  metadata?: string;
  oldDomain?: {
    name: string;
    address: string;
    expiry: number;
    metadata?: string;
  };
  signature?: string;
}

describe("Domain Name Service Contract", () => {
  it(`should prepare blocks data`, async () => {
    console.log("Preparing data...");
    console.time(`prepared data`);
    for (let j = 0; j < BLOCKS_NUMBER; j++) {
      const transactions: string[] = [];
      for (let i = 0; i < ELEMENTS_NUMBER; i++) {
        const tx: TransactionJSON = {
          operation: "add",
          name: uniqueNamesGenerator({
            dictionaries: [names],
            length: 1,
          }).toLowerCase(),
          address: PrivateKey.random().toPublicKey().toBase58(),
          expiry: Date.now() + 1000 * 60 * 60 * 24 * 365,
        };
        transactions.push(JSON.stringify(tx, null, 2));
      }
      console.log(
        "domainNames:",
        transactions.map((t) => JSON.parse(t).name)
      );
      transactions.push("this is invalid tx");
      domainNames.push(transactions);
    }

    console.timeEnd(`prepared data`);
  });

  it(`should initialize blockchain`, async () => {
    Memory.info("initializing blockchain");
    console.log("chain:", chain);
    nameContract.contractPrivateKey = contractPrivateKey;
    nameContract.contractAddress = contractPublicKey.toBase58();
    if (chain === "local" || chain === "lighnet") {
      const { keys } = await initBlockchain(chain, 2);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      if (keys.length < 2) throw new Error("Invalid keys");
      deployer = keys[0].key;

      try {
        await fetchMinaAccount({ publicKey: blockProducer.publicKey });
        if (!Mina.hasAccount(blockProducer.publicKey)) {
          console.log("Block producer account not found, creating...");

          const wallet = keys[1];
          console.log("wallet:", wallet.toBase58());
          const transaction = await Mina.transaction(
            { sender: wallet, fee: "100000000", memo: "payment" },
            async () => {
              const senderUpdate = AccountUpdate.createSigned(wallet);
              senderUpdate.balance.subInPlace(1000000000);
              senderUpdate.send({
                to: blockProducer.publicKey,
                amount: 500_000_000_000,
              });
            }
          );
          transaction.sign([wallet.key]);
          await sendTx(transaction, "block producer account creation");
        }
      } catch (error: any) {
        console.error("Error in block producer account creation:", error);
        return;
      }
    } else {
      console.log("non-local chain:", chain);
      await initBlockchain(chain);
      deployer = PrivateKey.fromBase58(DEPLOYER);
    }

    process.env.DEPLOYER = deployer.toBase58();
    if (deploy) {
      expect(contractPrivateKey).toBeDefined();
      expect(contractPrivateKey.toPublicKey().toBase58()).toBe(
        contractPublicKey.toBase58()
      );
    }

    console.log("blockchain initialized:", chain);
    console.log("contract address:", contractPublicKey.toBase58());
    sender = deployer.toPublicKey();
    const networkId = Mina.getNetworkId();
    console.log("Network ID:", networkId);
    console.log("sender:", sender.toBase58());
    console.log("Sender balance:", await accountBalanceMina(sender));
    console.log(
      "Block producer balance:",
      await accountBalanceMina(blockProducer.publicKey)
    );
    expect(deployer).toBeDefined();
    expect(sender).toBeDefined();
    expect(deployer.toPublicKey().toBase58()).toBe(sender.toBase58());
    process.env.PINATA_JWT = PINATA_JWT;
    expect(process.env.PINATA_JWT).toBeDefined();
    Memory.info("blockchain initialized");
  });

  if (deploy) {
    it(`should compile contract`, async () => {
      console.log("Analyzing contract methods...");
      console.time("methods analyzed");
      //console.log("Analyzing MapUpdate methods...");
      const mapMethods = await MapUpdate.analyzeMethods();
      //console.log("Analyzing BlockContract methods...");
      const blockMethods = await BlockContract.analyzeMethods();
      //console.log("Analyzing ValidatorsVoting methods...");
      const validatorsMethods = await ValidatorsVoting.analyzeMethods();
      //console.log("Analyzing DomainNameContract methods...");
      const domainMethods = await DomainNameContract.analyzeMethods();
      const methods = [
        {
          name: "DomainNameContract",
          result: domainMethods,
        },
        { name: "BlockContract", result: blockMethods },
        {
          name: "ValidatorsVoting",
          result: validatorsMethods,
          skip: true,
        },
        {
          name: "MapUpdate",
          result: mapMethods,
          skip: true,
        },
      ];
      console.timeEnd("methods analyzed");
      const maxRows = 2 ** 16;
      for (const contract of methods) {
        // calculate the size of the contract - the sum or rows for each method
        const size = Object.values(contract.result).reduce(
          (acc, method) => acc + method.rows,
          0
        );
        // calculate percentage rounded to 0 decimal places
        const percentage = Math.round((size / maxRows) * 100);

        console.log(
          `method's total size for a ${contract.name} is ${size} rows (${percentage}% of max ${maxRows} rows)`
        );
        if (contract.skip !== true)
          for (const method in contract.result) {
            console.log(method, `rows:`, (contract.result as any)[method].rows);
          }
      }

      console.time("compiled");
      console.log("Compiling contracts...");
      const cache: Cache = Cache.FileSystem("./cache");
      console.time("MapUpdate compiled");
      mapVerificationKey = (await MapUpdate.compile({ cache })).verificationKey;
      console.timeEnd("MapUpdate compiled");
      console.time("ValidatorsVoting compiled");
      validatorsVerificationKey = (await ValidatorsVoting.compile({ cache }))
        .verificationKey;
      console.timeEnd("ValidatorsVoting compiled");
      console.time("BlockContract compiled");
      blockVerificationKey = (await BlockContract.compile({ cache }))
        .verificationKey;
      console.timeEnd("BlockContract compiled");
      console.time("DomainNameContract compiled");
      contractVerificationKey = (await DomainNameContract.compile({ cache }))
        .verificationKey;
      console.timeEnd("DomainNameContract compiled");
      console.timeEnd("compiled");
      console.log(
        "contract verification key",
        contractVerificationKey.hash.toJSON()
      );
      console.log("block verification key", blockVerificationKey.hash.toJSON());
      Memory.info("compiled");
    });

    it(`should deploy contract`, async () => {
      console.log(`Deploying contract...`);

      await fetchMinaAccount({ publicKey: sender, force: true });

      const tx = await Mina.transaction(
        { sender, fee: await fee(), memo: "deploy" },
        async () => {
          AccountUpdate.fundNewAccount(sender);
          await zkApp.deploy({});
          zkApp.validatorsPacked.set(validators.pack());
          zkApp.domain.set(Encoding.stringToFields("mina")[0]);
          zkApp.account.zkappUri.set("https://zkcloudworker.com");
        }
      );

      tx.sign([deployer, contractPrivateKey]);
      await sendTx(tx, "deploy");
      Memory.info("deployed");
      await sleep(30000);
    });

    it(`should sent block 0`, async () => {
      console.log(`Sending block 0...`);
      Memory.info("sending block 0");
      await fetchMinaAccount({ publicKey: sender, force: true });
      await fetchMinaAccount({ publicKey: contractPublicKey, force: true });

      const tx = await Mina.transaction(
        { sender, fee: await fee(), memo: "block 0" },
        async () => {
          AccountUpdate.fundNewAccount(sender);
          await zkApp.blockZero(
            nameContract.firstBlockPublicKey!,
            UInt64.from(Date.now())
          );
        }
      );
      await tx.prove();
      tx.sign([deployer, nameContract.firstBlockPrivateKey!]);
      await sendTx(tx, "block 0");
      Memory.info("block 0 sent");
      await sleep(30000);
      //console.log("PINATA_JWT:", process.env.PINATA_JWT);
    });
  }

  if (!deploy) {
    it(`should restart the sequencer`, async () => {
      console.log(`Restarting sequencer...`);
      let args: string = JSON.stringify({
        contractAddress: contractPublicKey.toBase58(),
      });
      let apiresult = await api.execute({
        repo: "nameservice",
        task: "restart",
        transactions: [],
        args,
        developer: "@staketab",
        metadata: `txTask`,
        mode: "sync",
      });
      expect(apiresult).toBeDefined();
      if (apiresult === undefined) return;
      expect(apiresult.success).toBe(true);
    });
  }

  it(`should add task to process transactions`, async () => {
    console.log(`Adding task to process transactions...`);
    let args: string = JSON.stringify({
      contractAddress: contractPublicKey.toBase58(),
    });
    const apiresult = await api.execute({
      repo: "nameservice",
      task: "createTxTask",
      transactions: [],
      args,
      developer: "@staketab",
      metadata: `txTask`,
      mode: "sync",
    });
    expect(apiresult).toBeDefined();
    if (apiresult === undefined) return;
    expect(apiresult.success).toBe(true);
    console.log(`Processing tasks...`);
    while (
      (await LocalCloud.processLocalTasks({
        developer: "@staketab",
        repo: "nameservice",
        localWorker: zkcloudworker,
        chain: "local",
      })) > 1
    ) {
      await sleep(10000);
    }
  });

  it(`should send transactions`, async () => {
    for (let i = 0; i < BLOCKS_NUMBER; i++) {
      console.time(`Txs to the block sent`);
      const apiresult = await api.sendTransactions({
        repo: "nameservice",
        developer: "@staketab",
        transactions: domainNames[i],
      });
      expect(apiresult).toBeDefined();
      if (apiresult === undefined) return;
      expect(apiresult.success).toBe(true);
      console.log(`tx api call result:`, apiresult);
      console.timeEnd(`Txs to the block sent`);

      console.log(`Processing tasks...`);
      while (
        (await LocalCloud.processLocalTasks({
          developer: "@staketab",
          repo: "nameservice",
          localWorker: zkcloudworker,
          chain: "local",
        })) > 1
      ) {
        await sleep(10000);
      }
      Memory.info(`tasks processed`);
    }
  });

  it.skip(`should change validators`, async () => {
    console.log(`Changing validators...`);
    Memory.info("changing validators");
    const expiry = UInt64.from(Date.now() + 1000 * 60 * 60 * 24 * 2000);
    const decision = new ValidatorsDecision({
      contractAddress: contractPublicKey,
      chainId: getNetworkIdHash(),
      validators,
      decisionType: ValidatorDecisionType.setValidators,
      data: ChangeValidatorsData.toFields({
        new: validators,
        old: validators,
        storage: new Storage({ hashString: [Field(0), Field(0)] }),
      }),
      expiry,
    });
    const proof: ValidatorsVotingProof = await calculateValidatorsProof(
      decision,
      validatorsVerificationKey,
      false
    );
    const ok = await verify(proof.toJSON(), validatorsVerificationKey);
    console.log("proof verified:", { ok });
    expect(ok).toBe(true);
    if (!ok) throw new Error("Proof is not verified");

    await fetchMinaAccount({ publicKey: sender, force: true });
    await fetchMinaAccount({ publicKey: contractPublicKey, force: true });

    const tx = await Mina.transaction(
      { sender, fee: await fee(), memo: "change validators" },
      async () => {
        await zkApp.setValidators(proof);
      }
    );
    Memory.info("proving");
    console.log("proving...");
    await tx.prove();
    Memory.info("signing");
    console.log("signing...");
    tx.sign([deployer]);
    Memory.info("sending");
    console.log("sending...");
    await sendTx(tx, "Change validators");
    Memory.info("validators changed");
  });
});

async function sendTx(tx: any, description?: string) {
  const txSent = await tx.send();
  if (txSent.errors.length > 0) {
    console.error(
      `${description ?? ""} tx error: hash: ${txSent.hash} status: ${
        txSent.status
      }  errors: ${txSent.errors}`
    );
    throw new Error("Transaction failed");
  }
  console.log(
    `${description ?? ""} tx sent: hash: ${txSent.hash} status: ${
      txSent.status
    }`
  );

  const txIncluded = await txSent.wait();
  console.log(
    `${description ?? ""} tx included into block: hash: ${
      txIncluded.hash
    } status: ${txIncluded.status}`
  );
  if (chain !== "local") await sleep(10000);
}

async function accountBalance(address: PublicKey): Promise<UInt64> {
  try {
    await fetchAccount({ publicKey: address });
    if (Mina.hasAccount(address)) return Mina.getBalance(address);
    else return UInt64.from(0);
  } catch (error: any) {
    console.log("fetchAccount error: ", error);
    return UInt64.from(0);
  }
}

async function accountBalanceMina(address: PublicKey): Promise<number> {
  return Number((await accountBalance(address)).toBigInt()) / 1e9;
}

/*
  it.skip(`should send block 1`, async () => {
    console.log(`Sending block 1...`);
    const expiry = UInt64.from(Date.now() + 1000 * 60 * 60 * 24 * 2000);
    const blockPrivateKey = PrivateKey.random();
    const blockPublicKey = blockPrivateKey.toPublicKey();

    const blockStorage = Storage.fromIpfsHash(
      "bafkreifnek4e2r4cz62h22rwtxsi4bhsq6tt6ceeixdddyurpez32c6w64"
    );
    const blockProducerPrivateKey = PrivateKey.random();
    const blockProducerPublicKey = blockProducerPrivateKey.toPublicKey();
    const oldRoot = tree.getRoot();

    const decision = new ValidatorsDecision({
      contract: contractPublicKey,
      chainId,
      root: validatorsRoot,
      decision: ValidatorDecisionType.createBlock,
      address: blockProducerPublicKey,
      data: ValidatorDecisionExtraData.fromBlockCreationData({
        verificationKey: blockVerificationKey,
        blockPublicKey,
        oldRoot,
      }),
      expiry: UInt64.from(Date.now() + 1000 * 60 * 60 * 24 * 2000),
    });
    const proof: ValidatorsVotingProof = await calculateValidatorsProof(
      decision,
      validatorsVerificationKey,
      false
    );
    if (proof.publicInput.hash.toJSON() !== totalHash.toJSON())
      throw new Error("Invalid validatorsHash");
    const ok = await verify(proof, validatorsVerificationKey);
    if (!ok) throw new Error("proof verification failed");
    console.log("validators proof verified:", ok);

    const blockData: BlockData = new BlockData({
      address: blockPublicKey,
      root: oldRoot,
      storage: blockStorage,
      txs: new NewBlockTransactions({ count: Field(0), value: Field(0) }),
      isFinal: Bool(false),
      isProved: Bool(false),
      isInvalid: Bool(false),
      isValidated: Bool(false),
      blockNumber: Field(1),
    });

    await fetchMinaAccount({ publicKey: sender, force: true });
    await fetchMinaAccount({ publicKey: contractPublicKey, force: true });
    await fetchMinaAccount({
      publicKey: nameContract.firstBlockPublicKey!,
      tokenId,
      force: true,
    });

    const tx = await Mina.transaction(
      { sender, fee: await fee(), memo: `block 1` },
      async () => {
        AccountUpdate.fundNewAccount(sender);
        await zkApp.block(proof, blockData, blockVerificationKey); //signature,
      }
    );

    tx.sign([deployer, blockPrivateKey]);
    await tx.prove();
    tx.sign([deployer]);
    await sendTx(tx, "block 1");
    await sleep(20000);
    await fetchMinaAccount({ publicKey: contractPublicKey, force: true });
    const validators = zkApp.validators.get();
    const validatorsHash = zkApp.validatorsHash.get();
    expect(validators.toJSON()).toBe(validators.toJSON());
    expect(validatorsHash.toJSON()).toBe(totalHash.toJSON());
  });
*/

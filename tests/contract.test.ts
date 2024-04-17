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
  verify,
  Bool,
  Transaction,
} from "o1js";
import { validatorsPrivateKeys } from "../src/config";
import {
  ValidatorsDecision,
  ValidatorDecisionExtraData,
  ValidatorsVoting,
  ValidatorsVotingProof,
  ValidatorDecisionType,
} from "../src/rollup/validators";
import {
  DomainNameContract,
  BlockContract,
  BlockData,
  NewBlockTransactions,
} from "../src/contract/domain-contract";
import { stringToFields } from "../src/lib/hash";
import {
  getValidatorsTreeAndHash,
  calculateValidatorsProof,
} from "../src/rollup/validators-proof";
import { Storage } from "../src/contract/storage";
import { nameContract, JWT } from "../src/config";
import {
  zkCloudWorkerClient,
  makeString,
  initBlockchain,
  blockchain,
  accountBalanceMina,
  sleep,
  LocalCloud,
  Memory,
  fetchMinaAccount,
  fee,
} from "zkcloudworker";
import {
  DomainName,
  DomainNameValue,
  DomainTransaction,
  DomainTransactionData,
  DomainTransactionEnum,
  MapUpdate,
} from "../src/rollup/transaction";
import { Metadata } from "../src/contract/metadata";
import { zkcloudworker } from "../src/worker"; //, setVerificationKey
import { DEPLOYER, PINATA_JWT } from "../env.json";

setNumberOfWorkers(8);
const useLocalBlockchain = false;
const network: blockchain = useLocalBlockchain ? "local" : "devnet";
const useLocalCloudWorker = true;
const chainId = Field(1);
const api = new zkCloudWorkerClient({
  jwt: useLocalCloudWorker ? "local" : JWT,
  zkcloudworker,
  chain: useLocalBlockchain ? "local" : "devnet",
});

let deployer: PrivateKey;
let sender: PublicKey;
const ELEMENTS_NUMBER = 3;
const BLOCKS_NUMBER = 1;
const domainNames: string[][] = [];

const { tree, totalHash } = getValidatorsTreeAndHash();
const validators = validatorsPrivateKeys.map((key) => key.toPublicKey());
const validatorsRoot = tree.getRoot();
const contractPrivateKey = PrivateKey.random();
const contractPublicKey = contractPrivateKey.toPublicKey();

const zkApp = new DomainNameContract(contractPublicKey);
let blockVerificationKey: VerificationKey;
let validatorsVerificationKey: VerificationKey;
let mapVerificationKey: VerificationKey;
let contractVerificationKey: VerificationKey;
const tokenId: Field = zkApp.deriveTokenId();

describe("Domain Name Service Contract", () => {
  it(`should prepare blocks data`, async () => {
    console.log("Preparing data...");
    console.time(`prepared data`);
    const nftStorage = new Storage({ hashString: [Field(0), Field(0)] });
    for (let j = 0; j < BLOCKS_NUMBER; j++) {
      const blockElements: string[] = [];
      for (let i = 0; i < ELEMENTS_NUMBER; i++) {
        const domainName: DomainName = new DomainName({
          name: stringToFields(makeString(20))[0],
          data: new DomainNameValue({
            address: PrivateKey.random().toPublicKey(),
            metadata: new Metadata({
              data: Field(0),
              kind: Field(0),
            }),
            storage: nftStorage,
            expiry: UInt64.from(Date.now() + 1000 * 60 * 60 * 24 * 365),
          }),
        });
        const domainTransaction: DomainTransaction = new DomainTransaction({
          type: DomainTransactionEnum.add,
          domain: domainName,
        });
        const domainTransactionData: DomainTransactionData =
          new DomainTransactionData(domainTransaction);
        blockElements.push(
          JSON.stringify(domainTransactionData.toJSON(), null, 2)
        );
      }
      domainNames.push(blockElements);
    }
    console.timeEnd(`prepared data`);
  });

  it(`should initialize blockchain`, async () => {
    if (useLocalBlockchain) {
      const Local = Mina.LocalBlockchain({
        proofsEnabled: true,
      });
      Mina.setActiveInstance(Local);
      deployer = Local.testAccounts[0].privateKey;
    } else {
      const networkInstance = Mina.Network({
        mina: [
          "https://api.minascan.io/node/devnet/v1/graphql",
          "https://proxy.devnet.minaexplorer.com/graphql",
        ],
      });
      Mina.setActiveInstance(networkInstance);
      deployer = PrivateKey.fromBase58(DEPLOYER);
    }

    process.env.DEPLOYER = deployer.toBase58();

    console.log("blockchain initialized:", network);
    console.log("contract address:", contractPublicKey.toBase58());
    sender = deployer.toPublicKey();
    const networkId = Mina.getNetworkId();
    console.log("Network ID:", networkId);
    console.log("sender", sender.toBase58());
    console.log("Sender balance", await accountBalanceMina(sender));
    expect(deployer).toBeDefined();
    expect(sender).toBeDefined();
    expect(deployer.toPublicKey().toBase58()).toBe(sender.toBase58());
    process.env.PINATA_JWT = PINATA_JWT;
    expect(process.env.PINATA_JWT).toBeDefined();
  });

  it.skip(`should compile contract`, async () => {
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
    mapVerificationKey = (await MapUpdate.compile({ cache })).verificationKey;
    validatorsVerificationKey = (await ValidatorsVoting.compile({ cache }))
      .verificationKey;
    blockVerificationKey = (await BlockContract.compile({ cache }))
      .verificationKey;
    //setVerificationKey(blockVerificationKey, validatorsVerificationKey);
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
    console.log(`Deploying contract...`);
    await fetchMinaAccount({ publicKey: sender, force: true });

    const tx = await Mina.transaction(
      { sender, fee: await fee(), memo: "deploy" },
      async () => {
        AccountUpdate.fundNewAccount(sender);
        await zkApp.deploy({});
        zkApp.validators.set(validatorsRoot);
        zkApp.validatorsHash.set(totalHash);
      }
    );

    tx.sign([deployer, contractPrivateKey]);
    await sendTx(tx, "deploy");
    Memory.info("deployed");
    await sleep(10000);
  });

  it.skip(`should sent block 0`, async () => {
    console.log(`Sending block 0...`);
    await fetchMinaAccount({ publicKey: sender, force: true });
    await fetchMinaAccount({ publicKey: contractPublicKey, force: true });

    const tx = await Mina.transaction(
      { sender, fee: await fee(), memo: "block 0" },
      async () => {
        AccountUpdate.fundNewAccount(sender);
        await zkApp.firstBlock(nameContract.firstBlockPublicKey!);
      }
    );
    await tx.prove();
    tx.sign([deployer, nameContract.firstBlockPrivateKey!]);
    await sendTx(tx, "block 0");
    Memory.info("block 0 sent");
    await sleep(10000);
    //console.log("PINATA_JWT:", process.env.PINATA_JWT);
  });

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
    /*
    const signature = Signature.create(
      blockProducerPrivateKey,
      BlockData.toFields(blockData)
    );
    */
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

  it(`should send transactions`, async () => {
    console.log(`Adding task to process transactions...`);
    let args: string = JSON.stringify({
      contractAddress:
        "B62qnMamFGnWsMkopVzeKvUh1CZEQbbNpkPCsjFfcsS2sgHFyWQFC7R",
      // "B62qnBuXnXAWg1uUbMrktsXzcWc89yieG2bQkRxM9JATu2WGvPYPwRr",
      //contractPublicKey.toBase58(),
      //"B62qqPUw2jxSBGsBjTKWKxjcdQ15hzmYEjF4hn9uqBKbRQLzZx1mR1W", //contractPublicKey.toBase58(),
    });

    let sent = false;
    let apiresult;
    let attempt = 1;
    while (sent === false) {
      apiresult = await api.execute({
        repo: "nameservice",
        task: "createTxTask",
        transactions: [],
        args,
        developer: "@staketab",
        metadata: `txTask`,
      });
      if (apiresult.success === true) sent = true;
      else {
        console.log(`Error creating job for txTask, retrying...`);
        await sleep(30000 * attempt);
        attempt++;
      }
    }

    expect(apiresult).toBeDefined();
    if (apiresult === undefined) return;
    expect(apiresult.success).toBe(true);

    expect(apiresult.jobId).toBeDefined();
    console.log(`txTask created, jobId:`, apiresult.jobId);
    if (apiresult.jobId === undefined) return;

    for (let i = 0; i < BLOCKS_NUMBER; i++) {
      const blockNumber = i + 1;
      console.time(`Txs to the block ${blockNumber} sent`);
      for (let j = 0; j < ELEMENTS_NUMBER; j++) {
        let sent = false;
        let apiresult;
        let attempt = 1;
        while (sent === false) {
          apiresult = await api.sendTransaction({
            repo: "nameservice",
            transaction: domainNames[i][j],
            developer: "@staketab",
          });
          if (apiresult.success === true) sent = true;
          else {
            console.log(`Error sending tx ${j} to block ${i}, retrying...`);
            await sleep(30000 * attempt);
            attempt++;
          }
        }

        expect(apiresult).toBeDefined();
        if (apiresult === undefined) return;
        expect(apiresult.success).toBe(true);

        expect(apiresult.jobId).toBeDefined();
        //console.log(`Tx ${j + 1} sent, jobId:`, apiresult.jobId);
        if (apiresult.jobId === undefined)
          throw new Error("Job ID is undefined");
        await sleep(2000);
      }
      console.timeEnd(`Txs to the block ${blockNumber} sent`);

      while (
        (await LocalCloud.processLocalTasks({
          developer: "@staketab",
          repo: "nameservice",
          localWorker: zkcloudworker,
          chain: "local",
        })) > 1
      ) {
        await sleep(30000);
      }
      Memory.info(`block ${blockNumber} processed`);
    }
    console.log(`Processing remaining tasks...`);
    while (
      (await LocalCloud.processLocalTasks({
        developer: "@staketab",
        repo: "nameservice",
        localWorker: zkcloudworker,
        chain: "local",
      })) > 1
    ) {
      await sleep(30000);
    }
  });

  it.skip(`should change validators`, async () => {
    console.log(`Changing validators...`);
    const expiry = UInt64.from(Date.now() + 1000 * 60 * 60 * 24 * 2000);
    const decision = new ValidatorsDecision({
      contract: contractPublicKey,
      chainId,
      root: validatorsRoot,
      decision: ValidatorDecisionType.setValidators,
      address: PrivateKey.random().toPublicKey(),
      data: ValidatorDecisionExtraData.fromSetValidatorsData({
        root: validatorsRoot,
        hash: totalHash,
        oldRoot: tree.getRoot(),
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
    await tx.prove();
    tx.sign([deployer]);
    await sendTx(tx, "Change validators");
    await sleep(20000);
    await fetchMinaAccount({ publicKey: contractPublicKey, force: true });
    const validators = zkApp.validators.get();
    const validatorsHash = zkApp.validatorsHash.get();
    expect(validators.toJSON()).toBe(validators.toJSON());
    expect(validatorsHash.toJSON()).toBe(totalHash.toJSON());
  });
});

async function sendTx(tx: Transaction, description?: string) {
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
}

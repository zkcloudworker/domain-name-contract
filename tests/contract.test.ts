import { describe, expect, it } from "@jest/globals";
import {
  Field,
  PrivateKey,
  setNumberOfWorkers,
  Mina,
  AccountUpdate,
  VerificationKey,
  UInt64,
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
  getNetworkIdHash,
  accountBalanceMina,
  sleep,
  LocalCloud,
  Memory,
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
import { zkcloudworker } from "../src/worker";

setNumberOfWorkers(8);
const network: blockchain = "local";
const useLocalCloudWorker = true;
const api = new zkCloudWorkerClient({
  jwt: useLocalCloudWorker ? "local" : JWT,
  zkcloudworker,
  chain: "local",
});

const { keys, networkIdHash } = initBlockchain(network, 1);
const { privateKey: deployer, publicKey: sender } = keys[0];

const ELEMENTS_NUMBER = 3;
const BLOCKS_NUMBER = 5;
const domainNames: string[][] = [];

const { tree, totalHash } = getValidatorsTreeAndHash();
const validators = validatorsPrivateKeys.map((key) => key.toPublicKey());
const validatorsRoot = tree.getRoot();
const contractPrivateKey = PrivateKey.random();
const contractPublicKey = contractPrivateKey.toPublicKey();

const zkApp = new DomainNameContract(contractPublicKey);
let verificationKey: VerificationKey;
let blockVerificationKey: VerificationKey;
let mapVerificationKey: VerificationKey;
let tokenId: Field;

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

  it(`should compile and deploy contract`, async () => {
    const networkId = Mina.getNetworkId();
    console.log("Network ID:", networkId);
    const networkIdHash = getNetworkIdHash();
    console.log("Network ID hash:", networkIdHash.toJSON());
    //console.log("sender", sender.toBase58());
    console.log("Sender balance", await accountBalanceMina(sender));
    expect(deployer).toBeDefined();
    expect(sender).toBeDefined();
    expect(deployer.toPublicKey().toBase58()).toBe(sender.toBase58());

    console.time("methods analyzed");
    const methods = [
      {
        name: "DomainNameContract",
        result: DomainNameContract.analyzeMethods(),
      },
      { name: "BlockContract", result: BlockContract.analyzeMethods() },
      {
        name: "ValidatorsVoting",
        result: ValidatorsVoting.analyzeMethods(),
        skip: true,
      },
      {
        name: "MapUpdate",
        result: MapUpdate.analyzeMethods(),
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
    verificationKey = (await ValidatorsVoting.compile()).verificationKey;
    blockVerificationKey = (await BlockContract.compile()).verificationKey;
    mapVerificationKey = (await MapUpdate.compile()).verificationKey;
    await DomainNameContract.compile();
    console.timeEnd("compiled");

    const tx = await Mina.transaction({ sender }, () => {
      AccountUpdate.fundNewAccount(sender);
      zkApp.deploy({});
      zkApp.validators.set(validatorsRoot);
      zkApp.validatorsHash.set(totalHash);
    });

    await tx.sign([deployer, contractPrivateKey]).send();

    const tx2 = await Mina.transaction({ sender }, () => {
      AccountUpdate.fundNewAccount(sender);
      zkApp.firstBlock(nameContract.firstBlockPublicKey!);
    });
    await tx2.prove();
    await tx2.sign([deployer, nameContract.firstBlockPrivateKey!]).send();
    tokenId = zkApp.deriveTokenId();
    Memory.info("deployed");
  });

  it(`should add task to process transactions`, async () => {
    console.log(`Adding task to process transactions...`);
    let args: string = JSON.stringify({
      contractAddress: contractPublicKey.toBase58(),
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
  });

  for (let i = 0; i < BLOCKS_NUMBER; i++) {
    const blockNumber = i + 1;
    it(`should create a block`, async () => {
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
        console.log(`Tx ${j + 1} sent, jobId:`, apiresult.jobId);
        if (apiresult.jobId === undefined)
          throw new Error("Job ID is undefined");
        await sleep(2000);
      }
      console.timeEnd(`Txs to the block ${blockNumber} sent`);
    });

    it(`should process tasks`, async () => {
      while (
        (await LocalCloud.processLocalTasks({
          developer: "@staketab",
          repo: "nameservice",
          localWorker: zkcloudworker,
          chain: "local",
        })) > 1
      ) {
        await sleep(1000);
      }
    });
    Memory.info(`block ${blockNumber} processed`);
  }

  it(`should process remaining tasks`, async () => {
    console.log(`Processing remaining tasks...`);
    while (
      (await LocalCloud.processLocalTasks({
        developer: "@staketab",
        repo: "nameservice",
        localWorker: zkcloudworker,
        chain: "local",
      })) > 1
    ) {
      await sleep(1000);
    }
  });

  it(`should change validators`, async () => {
    console.log(`Changing validators...`);
    const decision = new ValidatorsDecision({
      contract: contractPublicKey,
      chainId: networkIdHash,
      root: validatorsRoot,
      decision: ValidatorDecisionType.setValidators,
      address: PrivateKey.random().toPublicKey(),
      data: ValidatorDecisionExtraData.fromSetValidatorsData({
        root: Field(1),
        hash: Field(1),
        oldRoot: tree.getRoot(),
      }),
      expiry: UInt64.from(Date.now() + 1000 * 60 * 60),
    });
    const proof: ValidatorsVotingProof = await calculateValidatorsProof(
      decision,
      verificationKey,
      false
    );

    const tx2 = await Mina.transaction({ sender }, () => {
      zkApp.setValidators(proof);
    });
    await tx2.prove();
    await tx2.sign([deployer]).send();
    const validators = zkApp.validators.get();
    const validatorsHash = zkApp.validatorsHash.get();
    expect(validators.toJSON()).toBe(Field(1).toJSON());
    expect(validatorsHash.toJSON()).toBe(Field(1).toJSON());
  });
});

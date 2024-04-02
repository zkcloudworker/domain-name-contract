import {
  zkCloudWorker,
  Cloud,
  sleep,
  fee,
  DeployedSmartContract,
} from "zkcloudworker";
import os from "os";
import {
  verify,
  JsonProof,
  VerificationKey,
  Field,
  PublicKey,
  Signature,
  fetchAccount,
  Mina,
  setNumberOfWorkers,
} from "o1js";
import {
  MapTransition,
  MapUpdate,
  MapUpdateData,
  MapUpdateProof,
} from "./rollup/transaction";
import { Storage } from "./contract/storage";

export class DomainNameServiceWorker extends zkCloudWorker {
  static mapUpdateVerificationKey: VerificationKey | undefined = undefined;
  static mapContractVerificationKey: VerificationKey | undefined = undefined;

  constructor(cloud: Cloud) {
    super(cloud);
  }
  public async deployedContracts(): Promise<DeployedSmartContract[]> {
    throw new Error("not implemented");
  }

  private async compile(): Promise<void> {
    if (DomainNameServiceWorker.mapUpdateVerificationKey !== undefined) {
      console.log("mapUpdateVerificationKey already exists");
      return;
    }
    const cpuCores = os.cpus();
    const numberOfCPUCores = cpuCores.length;
    console.log("CPU cores:", numberOfCPUCores);
    console.time("compiled MapUpdate");
    DomainNameServiceWorker.mapUpdateVerificationKey = (
      await MapUpdate.compile({
        cache: this.cloud.cache,
      })
    ).verificationKey;
    console.timeEnd("compiled MapUpdate");
  }

  public async create(transaction: string): Promise<string | undefined> {
    await this.compile();

    if (DomainNameServiceWorker.mapUpdateVerificationKey === undefined)
      throw new Error("verificationKey is undefined");

    const args = JSON.parse(transaction);
    const isAccepted = args.isAccepted;
    const state: MapTransition = MapTransition.fromFields(
      args.state.map((f: string) => Field.fromJSON(f))
    ) as MapTransition;

    let proof: MapUpdateProof;
    //if (isAccepted === true) {
    const update: MapUpdateData = MapUpdateData.fromFields(
      args.update.map((f: string) => Field.fromJSON(f))
    ) as MapUpdateData;

    proof = await MapUpdate.add(state, update);
    /*
    } 
    else {
      const name = Field.fromJSON(args.name);
      const root = Field.fromJSON(args.root);
      proof = await MapUpdate.reject(state, root, name, address);
    }
    */
    const ok = await verify(
      proof.toJSON(),
      DomainNameServiceWorker.mapUpdateVerificationKey
    );
    if (!ok) throw new Error("proof verification failed");
    return JSON.stringify(proof.toJSON(), null, 2);
  }

  public async merge(
    proof1: string,
    proof2: string
  ): Promise<string | undefined> {
    await this.compile();
    try {
      if (DomainNameServiceWorker.mapUpdateVerificationKey === undefined)
        throw new Error("verificationKey is undefined");
      console.time("merge mapPoof");

      const sourceProof1: MapUpdateProof = MapUpdateProof.fromJSON(
        JSON.parse(proof1) as JsonProof
      );
      const sourceProof2: MapUpdateProof = MapUpdateProof.fromJSON(
        JSON.parse(proof2) as JsonProof
      );
      const state = MapTransition.merge(
        sourceProof1.publicInput,
        sourceProof2.publicInput
      );
      const proof = await MapUpdate.merge(state, sourceProof1, sourceProof2);
      const ok = await verify(
        proof.toJSON(),
        DomainNameServiceWorker.mapUpdateVerificationKey
      );
      if (!ok) throw new Error("proof verification failed");
      console.timeEnd("merge mapPoof");
      return JSON.stringify(proof.toJSON(), null, 2);
    } catch (error) {
      console.log("Error in merge", error);
      throw error;
    }
  }

  public async execute(): Promise<string | undefined> {
    throw new Error("not implemented");
  }
}

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  return new DomainNameServiceWorker(cloud);
}

/*
  public async send(transaction: string): Promise<string | undefined> {
    
    minaInit();
    const deployer = await getDeployer();
    const sender = deployer.toPublicKey();
    const contractAddress = PublicKey.fromBase58(this.args[1]);
    const zkApp = new MapContract(contractAddress);
    await fetchMinaAccount(deployer.toPublicKey());
    await fetchMinaAccount(contractAddress);
    let tx;

    const args = JSON.parse(transaction);
    if (this.args[0] === "add") {
      const name = Field.fromJSON(args.name);
      const address = PublicKey.fromBase58(args.address);
      const signature = Signature.fromBase58(args.signature);
      const storage: Storage = new Storage({
        hashString: [
          Field.fromJSON(args.storage[0]),
          Field.fromJSON(args.storage[1]),
        ],
      });

      tx = await Mina.transaction(
        { sender, fee: await fee(), memo: "add" },
        () => {
          zkApp.add(name, address, storage, signature);
        }
      );
    } else if (this.args[0] === "reduce") {
      try {
        const startActionState = Field.fromJSON(args.startActionState);
        const endActionState = Field.fromJSON(args.endActionState);
        const reducerState = new ReducerState({
          count: Field.fromJSON(args.reducerState.count),
          hash: Field.fromJSON(args.reducerState.hash),
        });
        const count = Number(reducerState.count.toBigInt());
        console.log("ReducerState count", reducerState.count.toJSON());
        await fetchMinaActions(contractAddress, startActionState);

        const proof: MapUpdateProof = MapUpdateProof.fromJSON(
          JSON.parse(args.proof) as JsonProof
        );
        console.log("proof count", proof.publicInput.count.toJSON());
        const signature = Signature.fromBase58(args.signature);

        tx = await Mina.transaction(
          { sender, fee: await fee(), memo: "reduce" },
          () => {
            zkApp.reduce(
              startActionState,
              endActionState,
              reducerState,
              proof,
              signature
            );
          }
        );
      } catch (error) {
        console.log("Error in reduce", error);
      }
    } else if (this.args[0] === "setRoot") {
      const root = Field.fromJSON(args.root);
      const count = Field.fromJSON(args.count);
      const signature = Signature.fromBase58(args.signature);

      tx = await Mina.transaction(
        { sender, fee: await fee(), memo: "reset" },
        () => {
          zkApp.setRoot(root, count, signature);
        }
      );
    } else throw new Error("unknown action");

    if (tx === undefined) throw new Error("tx is undefined");
    await tx.prove();
    const txSent = await tx.sign([deployer]).send();
    if (txSent === undefined) throw new Error("tx is undefined");
    const hash: string | undefined = txSent.hash;
    if (hash === undefined) throw new Error("hash is undefined");
    return hash;
    
    throw new Error("not implemented");
  }

  public async mint(transaction: string): Promise<string | undefined> {
    throw new Error("not implemented");
  }
  */

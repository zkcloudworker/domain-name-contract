import { Cloud, zkCloudWorker, initBlockchain } from "zkcloudworker";
import { initializeBindings } from "o1js";
import { DomainNameServiceWorker } from "./src/worker";

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  if (cloud.isLocalCloud === false) {
    await initializeBindings();
    await initBlockchain(cloud.chain);
  }
  return new DomainNameServiceWorker(cloud);
}

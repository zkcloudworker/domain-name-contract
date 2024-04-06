import { describe, expect, it } from "@jest/globals";
import os from "os";

describe("Workers", () => {
  it(`should get number of CPU cores`, async () => {
    const cpuCores = os.cpus();

    console.log(cpuCores);
    for (const core of cpuCores) {
      console.log(core.times);
    }

    const numberOfCPUCores = cpuCores.length;
    console.log("CPU cores:", numberOfCPUCores);
  });
});

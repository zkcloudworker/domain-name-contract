import zip from "adm-zip";
import fs from "fs/promises";

export async function saveZipFile(params: {
  data: string;
  filename: string;
}): Promise<string | undefined> {
  const zipFile = new zip();
  zipFile.addFile("data.json", Buffer.from(params.data));
  const folder = "./data/";
  const name = folder + params.filename + ".zip";
  try {
    await fs.access("./data");
  } catch (e) {
    // if not, create it
    await fs.mkdir("./data");
  }
  try {
    zipFile.writeZip(name);
    return name;
  } catch (e) {
    console.error(`Error writing file ${name}`);
    return undefined;
  }
}

export async function loadZipFile(
  filename: string
): Promise<string | undefined> {
  const name = "./data/" + filename + ".zip";
  try {
    const json = await fs.readFile(name);
    const zipFile = new zip(json);
    const data = zipFile.readAsText("data.json");
    return data;
  } catch (e) {
    console.error(`File ${name} does not exist or has wrong format`);
    return undefined;
  }
}

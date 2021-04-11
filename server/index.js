const fs = require("fs");
const MeshServer = require("../protocol/core/server");
const {dataDir} = require("../shared");
require("colors");

const node = process.argv[2];

if (!node) {
	console.log("An argument in the format \"address:port\" is required.");
	process.exit(1);
}

const port = Number(node.split(":").pop());

const bootstrapList = fs.readFileSync(
	`${__dirname}/../shared/nodes.txt`, "utf8"
);

const nodesDir = `${dataDir}/mesh-server`;
if (!fs.existsSync(nodesDir)) fs.mkdirSync(nodesDir);
const storeFile = `${nodesDir}/store-${port}.json`;

const mesh = new MeshServer(node, bootstrapList, storeFile);
mesh.start();

console.log(`Server running: ${node.brightCyan}.`);

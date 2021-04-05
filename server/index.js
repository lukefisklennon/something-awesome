const fs = require("fs");
const MeshServer = require("../protocol/core/server");
const {dataDir} = require("../shared");

const node = process.argv[2];
const port = Number(node.split(":").pop());

if (!node) {
	console.log("An argument in the format \"address:port\" is required.");
	process.exit(1);
}

const bootstrapList = fs.readFileSync(
	`${__dirname}/../shared/nodes.txt`, "utf8"
);

const nodesDir = `${dataDir}/mesh-server`;

if (!fs.existsSync(nodesDir)) fs.mkdirSync(nodesDir);
const nodesStore = `${nodesDir}/nodes-${port}.txt`;

const mesh = new MeshServer(node, bootstrapList, nodesStore);

console.log(`Mesh server starting on port ${port}.`);
mesh.start();

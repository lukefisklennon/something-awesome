const spawn = require("child_process").spawn;
require("colors");

const basePort = 3000;

const prefixLines = (data, prefix) => (
	data.split("\n").filter(
		(line) => line.length
	).map(
		(line) => `${prefix} ${line}`
	).join("\n")
);

const runServer = (name, port) => {
	const node = `${name}:${port}`;

	const child = spawn("mesh-server", [node]);

	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");

	child.stdout.on("data", (data) => {
		console.log(prefixLines(data, `[${node}]`.grey));
	});

	child.stderr.on("data", (data) => {
		console.log(prefixLines(data, `[${node}]`.brightRed));
	});
}

const name = process.argv[2];

if (!name) {
	console.log(
		"An argument for the external IP address or domain name is required."
	);
	process.exit(1);
}

const n = Number(process.argv[3]);

if (!Number.isInteger(n)) {
	console.log("An argument for the number of servers to run is required.");
	process.exit(1);
}

for (let port = basePort; port < basePort + n; port++) {
	setTimeout(() => runServer(name, port), (port - basePort) * 100);
}

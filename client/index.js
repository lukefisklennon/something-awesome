const crypto = require("crypto");
const readline = require("readline");
const util = require("util");
const fs = require("fs");
const MeshClient = require("../protocol/chat");
const {dataDir} = require("../shared");
const qrcode = require("qrcode-terminal");
const {table, getBorderCharacters} = require("table");
require("colors");

let list = fs.readFileSync(`${__dirname}/../shared/nodes.txt`, "utf8");;
let users = [];
let privateKey = null;
let password = null;
let showingPrompt = true;
let currentChat = null;
let residence = null;

class User {
	constructor(publicKey, name, color) {
		this.publicKey = publicKey;
		this.name = name;
		this.color = color;
		this.history = [];
	}
}

class Message {
	constructor(fromSelf, timeSent, content) {
		this.fromSelf = fromSelf;
		this.timeSent = timeSent;
		this.content = content;
	}
}

const terminal = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

const question = terminal.question.bind(terminal);

const questionSync = util.promisify((query, callback) => question(
	query, (answer) => callback(null, answer)
));

const qr = util.promisify((input, options, callback) => qrcode.generate(
	input, options, (output) => callback(null, output)
));

qrcode.setErrorLevel("M");

const ivLength = 16;
const saltLength = 16;
const cipherKeyLength = 32;
const cipherAlgorithm = `aes-${cipherKeyLength * 8}-cbc-hmac-sha256`;
const helpJoiner = "\n   ";
const passwordChar = "*";
const passwordTimeout = 2000;
const defaultName = "user";
const colors = ["default", "red", "green", "yellow", "blue", "magenta", "cyan"];
const welcomeText = "Type \"help\" for a list of commands.";
const storeDir = `${dataDir}/mesh-client`;
const storeFile = `${storeDir}/store.txt`;

const getBrightColor = ([first, ...rest]) => (
	`bright${first.toUpperCase() + rest.join("")}`
);

const getColoredText = (text, color) => (
	(color === "default" ? text : text[getBrightColor(color)]).bold
);

const getColoredUser = (user) => getColoredText(user.name, user.color);
const getUserIndex = (indexString) => Number(indexString) - 1;

const commands = {
	"help": () => (
		`Commands:${helpJoiner}${Object.keys(commands).join(helpJoiner)}`
	),
	"add [user key]": (args) => {
		users.push(new User(args[0], defaultName.grey, "default"));
		writeStore();
		return `Added user with key "${args[0]}".`;
	},
	"remove [user #]": (args) => {
		const index = getUserIndex(args[0]);
		if (index !== 0) {
			users.splice(index, 1);
			writeStore();
			return `Removed user #${args[0]}.`;
		} else {
			return "You cannot remove yourself.";
		}
	},
	"chat [user #]": async (args) => {
		showingPrompt = false;

		currentChat = users[getUserIndex(args[0])];

		clearScreen();
		displayHistory();
		await chat();
	},
	"qr [optional user #]": async (args) => {
		const user = users[args.length > 0 ? getUserIndex(args[0]) : 0];
		const result = await qr(user.publicKey, {small: true});
		return (
			`Scan to get ${getColoredUser(user)}’s public key:\n${result}`
		);
	},
	[`set name [text]${helpJoiner}set color`]: async (args) => {
		if (args[0] === "name") {
			users[0].name = args[1];
		} else if (args[0] === "color") {
			users[0].color = await questionColorSync();
		} else {
			return;
		}

		writeStore();
		return `User information updated.`;
	},
	"reset": async () => {
		fs.unlinkSync(storeFile);
		await setup();
	},
	"exit": () => process.exit()
};

const saltedPassword = (password, salt) => (
	crypto.scryptSync(password, salt, cipherKeyLength)
);

// Adapted from <https://stackoverflow.com/a/60370205/5583289>.
const encrypt = (text, password) => {
	const iv = crypto.randomBytes(ivLength);
	const salt = crypto.randomBytes(saltLength);
	const key = saltedPassword(password, salt);
	const cipher = crypto.createCipheriv(cipherAlgorithm, key, iv);

	let encrypted = cipher.update(text);
	encrypted = Buffer.concat([encrypted, cipher.final()]);

	return [iv, salt, encrypted].map((x) => (x).toString("base64")).join(",");
}

// Adapted from <https://stackoverflow.com/a/60370205/5583289>.
const decrypt = (text, password) => {
	const [iv, salt, encrypted] = text.split(",").map(
		(x) => Buffer.from(x, "base64")
	);

	const key = saltedPassword(password, salt);
	const decipher = crypto.createDecipheriv(cipherAlgorithm, key, iv);

	let decrypted = decipher.update(encrypted);
	decrypted = Buffer.concat([decrypted, decipher.final()]);

	return decrypted.toString();
}

const storeExists = () => fs.existsSync(storeFile);

const readStore = () => {
	try {
		(
			{users, privateKey, list} = JSON.parse(decrypt(
				fs.readFileSync(storeFile, "utf8"), password
			))
		);
	} catch (error) {
		return error.code;
	}
}

const writeStore = () => {
	if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir);
	fs.writeFileSync(storeFile, encrypt(
		JSON.stringify({users, privateKey, list}), password
	));
}

const listUsers = () => {
	const headers = ["#", "Name", "Key"];
	const selfSuffix = " (you)";
	let nameColumnWidth = mesh.nameMaxLength + selfSuffix.length;
	const indexColumnWidth = String(users.length + 1).length;
	const ttyColumns = process.stdout.columns;
	const keyLength = mesh.keyMaxLength;
	const nonContentWidth = (headers.length + 1) * 3 - 2;
	const nonKeyColumnSpace = (
		ttyColumns - indexColumnWidth - nameColumnWidth - nonContentWidth
	);

	let keyColumnWidth;
	if (nonKeyColumnSpace < keyLength) {
		keyColumnWidth = nonKeyColumnSpace;
		const resize = Math.ceil((keyLength - nonKeyColumnSpace) / 4);
		keyColumnWidth += resize;
		nameColumnWidth -= resize;
	} else {
		keyColumnWidth = keyLength;
	}

	if (nameColumnWidth < 1) nameColumnWidth = 1;
	if (keyColumnWidth < 1) keyColumnWidth = 1;

	console.log(table([
		headers, ...users.map((user, index) => (
			[
				index + 1,
				getColoredUser(user) + (index === 0 ? selfSuffix.grey : ""),
				user.publicKey
			]
		))
	], {
		border: getBorderCharacters("norc"),
		columns: {1: {width: nameColumnWidth}, 2: {width: keyColumnWidth}}
	}).trim());
}

const listColors = () => {
	console.log(`Colours: ${colors.map(
		(color) => getColoredText(color, color)
	).join(", ")}`);
}

const clearScreen = () => {
	console.log("\n".repeat(process.stdout.rows - 1));
	readline.cursorTo(process.stdout, 0, 0);
	readline.clearScreenDown(process.stdout);
}

const clearLines = (n) => {
	readline.cursorTo(process.stdout, 0);
	readline.moveCursor(process.stdout, 0, -n);
	readline.clearScreenDown(process.stdout);
}

// const clearLine = () => {
// 	readline.cursorTo(process.stdout, 0);
// 	readline.moveCursor(process.stdout, 0, -1);
// }

let lastOutput;

const prompt = async (output) => {
	lastOutput = output || lastOutput;

	clearScreen();
	console.log(
		`Connected to ${residence.split(":")[0].bold} as ` +
		`${getColoredUser(users[0])}.`
	);
	listUsers();
	console.log(lastOutput);

	const input = (await questionSync("> ")).trim();

	if (input.length === 0) {
		prompt();
		return;
	}

	const args = input.split(" ");

	for (let command in commands) {
		if (command.split(" ")[0] === args[0].toLowerCase()) {
			const output = await commands[command](args.slice(1));

			if (!showingPrompt) {
				showingPrompt = true;
				return;
			}

			prompt(output);
			return;
		}
	}

	await prompt(`Unknown command "${args[0]}". ${welcomeText}`);
}

process.stdout.on("resize", prompt);

const displayHistory = () => {
	console.log(
		`This is your chat with ${getColoredUser(currentChat)}. ` +
		`To exit, press enter.\n`
	);

	console.log(currentChat.history.map((message) => (
		renderMessage(
			message.fromSelf ? users[0] : currentChat, message.content
		)
	)).join("\n"));
}

const getChatPrompt = () => `${getColoredUser(users[0])}: `;

let chatTempText = null;

const chatUpdate = (tempText, permText) => {
	const lines = [
		...terminal._prompt.split("\n").slice(0, chatTempText ? -2 : -1)
	];

	if (permText) lines.push(permText);
	if (tempText) lines.push(tempText);
	lines.push(getChatPrompt());

	chatTempText = tempText;

	terminal.setPrompt(lines.join("\n"))
	terminal.prompt(true);
}

const renderMessage = (user, content) => (
	`${getColoredUser(user)}: ${message.content}`
);

const chatInsert = (user, content) => (
	chatUpdate(chatTempText, renderMessage(user, content))
);

const chatSetTempText = (text) => chatUpdate(text);

const chat = async () => {
	setImmediate(() => chatUpdate(chatTempText));

	const input = await questionSync(getChatPrompt());

	if (input.trim().length === 0) {
		const oldChat = currentChat;
		currentChat = null;

		if (showingPrompt) {
			prompt(`Chat with ${getColoredUser(oldChat)} closed.`);
		} else {
			showingPrompt = true;
		}

		return;
	}

	if (chatTempText) {
		clearLines(2);
		console.log(getChatPrompt() + input);
	}

	currentChat.history.push(new Message(true, input));
	mesh.send(currentChat.publicKey, input);

	writeStore();
	chat();
}

const questionColorSync = async () => {
	listColors();
	return await questionSync("Select user colour: ") || "default";
}

const questionPasswordSync = async (prompt) => {
	const old_writeToOutput = terminal._writeToOutput;

	terminal._writeToOutput = (string) => {
		if (string.trim().length === 0) {
			terminal.output.write(string);
			return;
		}

		const split = string.split(prompt);

		if (split.length === 2) {
			split[1] = passwordChar.repeat(split[1].length);
		} else {
			split[0] = passwordChar;
		}

		terminal.output.write(split.join(prompt));
	};

	const input = await questionSync(prompt);
	terminal._writeToOutput = old_writeToOutput;
	return input;
}

const connect = () => {
	console.log("Connecting...");
	residence = await mesh.bootstrap(list);

	prompt(welcomeText);
}

const start = async (noClear) => {
	if (!noClear) clearScreen();

	password = await questionPasswordSync("Enter password: ");
	const error = readStore();

	if (error === "ERR_OSSL_EVP_BAD_DECRYPT") {
		setTimeout(() => {
			console.log("Sorry, try again.");
			start(true);
		}, passwordTimeout);
		return;
	}

	connect();
}

const setup = async () => {
	clearScreen();

	const name = await questionSync("Set name: ") || defaultName;
	const color = await questionColorSync();
	password = await questionPasswordSync("Set password: ")

	mesh.generateKeys();

	users[0] = new User(mesh.getPublicKey(), name, color);
	privateKey = mesh.getPrivateKey();
	writeStore();

	connect();
}

const mesh = new MeshClient(discover);

mesh.on("discover", (newList) => {
	list = newList;
	writeStore();
});

mesh.on("message", (message) => {
	const from = users.find((user) => user.publicKey === message.from);

	if (from) {
		from.history.push(
			new Message(false, message.timeSent, message.content)
		);

		if (currentChat === from) chatInsert(from, message.content);
	}
});

storeExists() ? start() : setup();

const crypto = require("crypto");
const readline = require("readline");
const util = require("util");
const fs = require("fs");

const qrcode = require("qrcode-terminal");
const {table, getBorderCharacters} = require("table");
require("colors");

let users = [];
let privateKey = null;
let password = null;
let showingPrompt = true;
let currentChat = null;

const newUser = (publicKey, name, color) => (
	{publicKey, name, color, history: []}
);

const newMessage = (fromSelf, text) => ({fromSelf, text});

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
const colors = ["default", "red", "green", "yellow", "blue", "magenta", "cyan"];

const getBrightColor = ([first, ...rest]) => (
	`bright${first.toUpperCase() + rest.join("")}`
);

const getColoredText = (text, color) => (
	color === "default" ? text : text[getBrightColor(color)]
);

const getColoredUser = (user) => getColoredText(user.name, user.color);

const welcomeText = "Type \"help\" for a list of commands.";

const storeDir = (
	process.env.APPDATA || (
		process.platform == "darwin"
		? process.env.HOME + "/Library/Preferences"
		: process.env.HOME + "/.local/share"
	)
) + "/mesh";

const storeFile = `${storeDir}/store.json`;

const getUserIndex = (indexString) => Number(indexString) - 1;

const commands = {
	"help": () => (
		`Commands:${helpJoiner}${Object.keys(commands).join(helpJoiner)}`
	),
	"add [user key]": (args) => {
		users.push(newUser(args[0], "Unknown".grey, "default"));
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
			{users, privateKey} = JSON.parse(decrypt(
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
		JSON.stringify({users, privateKey}), password
	));
}

const listUsers = () => {
	const headers = ["#", "Name", "Key"];
	const selfSuffix = " (you)";
	let nameColumnWidth = 16 + selfSuffix.length; // TODO: get 16 value from protocol
	const indexColumnWidth = String(users.length + 1).length;
	const ttyColumns = process.stdout.columns;
	const keyLength = users[0].publicKey.length;
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
	console.log(`Logged in as ${getColoredUser(users[0])}.`);
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
		`${getColoredUser(message.fromSelf ? users[0] : currentChat)}: ` +
		`${message.text}`
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

const chatInsert = (text) => chatUpdate(chatTempText, text);
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

	currentChat.history.push(newMessage(true, input));
	writeStore();

	chat();
}

const questionColorSync = async () => {
	listColors();
	await questionSync("Select user colour: ") || "default";
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

const start = async (noClear) => {
	if (!noClear) clearScreen();

	password = await questionPasswordSync("Enter password: ");
	const error = readStore();

	if (error === "ERR_OSSL_EVP_BAD_DECRYPT") {
		setTimeout(() => {
			console.log("Sorry, try again.");
			start(true);
		}, passwordTimeout);
	} else {
		prompt(welcomeText);
	}
}

const setup = async () => {
	clearScreen();

	const name = await questionSync("Set name: ");
	const color = await questionColorSync();
	password = await questionPasswordSync("Set password: ")

	users[0] = newUser("W4XLi7FUqLifdvP5a9gCrjUxPd9qnCCFs7LWJ9yPC8CHtH", name, color); // TODO
	privateKey = "def";
	writeStore();

	prompt(welcomeText);
}

storeExists() ? start() : setup();

const crypto = require("crypto");
const readline = require("readline");
const util = require("util");
const fs = require("fs");
const MeshClient = require("../protocol/chat");
const {dataDir} = require("../shared");
const qrcode = require("qrcode-terminal");
const clipboard = require("clipboardy");
const {table, getBorderCharacters} = require("table");
require("colors");

const localAccount = process.argv[2];

if (!localAccount) {
	console.log("An argument for the local account name is required.");
	process.exit(1);
}

let list, users, privateKey;

const init = () => {
	list = fs.readFileSync(`${__dirname}/../shared/nodes.txt`, "utf8");
	users = [];
	privateKey = null;
}

init();

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
		this.unread = 0;
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

const promptText = "> ";
const helpJoiner = "\n   ";
const passwordChar = "*";
const passwordTimeout = 2000;
const defaultName = "user";
const colors = ["default", "red", "green", "yellow", "blue", "magenta", "cyan"];
const welcomeText = "Type \"help\" for a list of commands.";
const storeDir = `${dataDir}/mesh-client`;
const storeFile = `${storeDir}/store-${localAccount}.txt`;

const borderCharacters = {
	topBody: `─`,
	topJoin: `┬`,
	topLeft: `╭`,
	topRight: `╮`,
	bottomBody: `─`,
	bottomJoin: `┴`,
	bottomLeft: `╰`,
	bottomRight: `╯`,
	bodyLeft: `│`,
	bodyRight: `│`,
	bodyJoin: `│`,
	joinBody: `─`,
	joinLeft: `├`,
	joinRight: `┤`,
	joinJoin: `┼`
};

const getBrightColor = ([first, ...rest]) => (
	`bright${first.toUpperCase() + rest.join("")}`
);

const getColoredText = (text, color) => (
	(color === "default" ? text : text[getBrightColor(color)]).bold
);

const getColoredUser = (user) => getColoredText(user.name, user.color);

const getUserIndex = (indexString) => {
	const index = Number.parseInt(indexString) - 1;
	if (Number.isInteger(index)) return index;
	throw new Error();
}

const addUser = (user) => {
	users.push(user);
	writeStore();
}

const commands = {
	"help": () => (
		`Commands:${helpJoiner}${Object.keys(commands).join(helpJoiner)}`
	),
	"add [user key]": (args) => {
		if (args.length < 1) throw new Error();
		addUser(new User(args[0], defaultName.grey, "default"));
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
	"clipboard [optional user #]": (args) => {
		const user = users[args.length > 0 ? getUserIndex(args[0]) : 0];
		clipboard.writeSync(user.publicKey);
		return `Copied ${getColoredUser(user)}’s public key to clipboard.`;
	},
	"qr [optional user #]": async (args) => {
		const user = users[args.length > 0 ? getUserIndex(args[0]) : 0];
		const result = await qr(user.publicKey, {small: true});
		return (
			`Scan to get ${getColoredUser(user)}’s public key:\n${result}`
		);
	},
	[
		`set name [text]${helpJoiner}set color${helpJoiner}set password`
	]: async (args) => {
		switch (args[0]) {
			case "name":
				users[0].name = args[1];
				break;

			case "color":
				users[0].color = await questionColorSync();
				break;

			case "password":
				password = await questionPasswordSync("Set new password: ")
				break;

			default:
				throw new Error();
		}

		writeStore();

		return `Updated user information.`;
	},
	"reset": async () => {
		fs.unlinkSync(storeFile);
		init();
		await setup();
	},
	"exit": () => process.exit()
};

const storeExists = () => fs.existsSync(storeFile);

const readStore = () => {
	(
		{users, privateKey, list} = JSON.parse(mesh.decrypt(
			fs.readFileSync(storeFile, "utf8"), password
		))
	);
}

const writeStore = () => {
	if (!fs.existsSync(storeDir)) {
		fs.mkdirSync(storeDir);
	}

	fs.writeFileSync(storeFile, mesh.encrypt(
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

	const sortedUsers = [...users].sort((a, b) => {
		if (a === users[0]) return -1;
		if (b === users[0]) return 1;

		if (a.history.length > 0 || b.history.length > 0) {
			if (a.history.length === 0) return 1;
			if (b.history.length === 0) return -1;

			if (a.unread > 0 || b.unread > 0) {
				if (a.unread === 0) return 1;
				if (b.unread === 0) return -1;

				const aLastMessage = a.history.slice(-1)[0];
				const bLastMessage = b.history.slice(-1)[0];

				return bLastMessage.timeSent - aLastMessage.timeSent;
			}
		}

		return users.indexOf(a) - users.indexOf(b);
	});

	return table([
		headers, ...sortedUsers.map((user) => {
			const nameText = (
				(user.unread ? `(${user.unread}) `.brightRed : "")
				+ getColoredUser(user)
				+ (user === users[0] ? selfSuffix.grey : "")
			);

			return [users.indexOf(user) + 1, nameText, user.publicKey];
		})
	], {
		border: borderCharacters,
		columns: {1: {width: nameColumnWidth}, 2: {width: keyColumnWidth}}
	}).trim();
}

const listColors = () => {
	console.log(`Colours: ${colors.map(
		(color) => getColoredText(color, color)
	).join(", ")}`);
}

const clearScreen = (overwrite) => {
	if (!overwrite) console.log("\n".repeat(process.stdout.rows - 1));
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

const menu = () => (
	`Connected to ${residence.split(":")[0].bold} as ` +
	`${getColoredUser(users[0])}.\n${listUsers()}\n${lastOutput}\n${promptText}`
);

const prompt = async (output) => {
	lastOutput = output || lastOutput;

	clearScreen();

	const input = (await questionSync(menu())).trim();

	if (input.length === 0) {
		prompt();
		return;
	}

	const args = input.split(" ");

	for (let command in commands) {
		if (command.split(" ")[0] === args[0].toLowerCase()) {
			let output;
			try {
				output = await commands[command](args.slice(1));
			} catch (error) {
				output = `Usage: ${command}.`;
				showingPrompt = true;
			}

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

const updatePrompt = () => {
	if (!showingPrompt) return;

	clearScreen(true);
	terminal.setPrompt(menu());
	terminal.prompt(true);
}

process.stdout.on("resize", updatePrompt);

const displayHistory = () => {
	console.log(
		`This is your chat with ${getColoredUser(currentChat)}. ` +
		`To exit, press enter.`
	);

	console.log(currentChat.history.map((message, index) => (
		renderMessage(
			message.fromSelf ? users[0] : currentChat, message.content
		) + renderUnreadLine(currentChat, index)
	)).join("\n"));

	currentChat.unread = 0;
	writeStore();
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
	`${getColoredUser(user)}: ${content}`
);

const renderUnreadLine = (user, index) => (
	user.unread !== 0 && user.unread === user.history.length - index - 1
	? "\n" + "─".repeat(process.stdout.columns).brightRed : ""
)

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

	currentChat.history.push(new Message(true, Date.now(), input));

	if (currentChat !== users[0]) {
		mesh.sendMessage(currentChat.publicKey, users[0], input);
	}

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

const connect = async () => {
	console.log("Connecting...");

	mesh.bootstrap(list, (newResidence) => {
		residence = newResidence;
		prompt(welcomeText);
	});
}

const start = async (noClear) => {
	if (!noClear) clearScreen();

	password = await questionPasswordSync("Enter password: ");

	try {
		readStore();
	} catch (error) {
		setTimeout(() => {
			console.log("Sorry, try again.");
			start(true);
		}, passwordTimeout);

		return;
	}

	mesh.setPrivateKey(privateKey);

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

const mesh = new MeshClient();

mesh.on("discover", (newList) => {
	list = newList;
	writeStore();
});

mesh.on("message", (publicKey, timeSent, user, content) => {
	from = users.find((user) => user.publicKey === publicKey);

	if (from) {
		from.name = user.name;
		from.color = user.color;
	} else {
		from = new User(publicKey, user.name, user.color);
		addUser(from);
	}

	from.history.push(new Message(false, timeSent, content));

	if (currentChat === from) {
		chatInsert(from, content)
	} else {
		from.unread++;
		updatePrompt();
	}

	writeStore();
});

mesh.on("disconnected", () => {
	clearScreen();
	console.log("Disconnected.");
	process.exit(1);
})

storeExists() ? start() : setup();

const readline = require("readline");
const util = require("util");
const fs = require("fs");
const MeshClient = require("../protocol/chat");
const fetch = require("node-fetch");
const qrcode = require("qrcode-terminal");
const clipboard = require("clipboardy");
const {dataDir} = require("../shared");
const {table} = require("table");
require("colors");

const print = (text) => process.stdout.write(`${text || ""}\n`);

const localAccount = process.argv[2];

if (!localAccount) {
	print("An argument for the local account name is required.");
	process.exit(1);
}

let list, users, privateKey;

const init = () => {
	list = fs.readFileSync(`${__dirname}/../shared/nodes.txt`, "utf8");
	users = [];
	privateKey = null;
}

init();

let password = "";
let showingPrompt = true;
let currentChat = null;
let oldChat = null;
let residence;

class User {
	constructor(publicKey, name, color) {
		this.publicKey = publicKey;
		this.name = name;
		this.color = color;
		this.history = [];
		this.unread = 0;
		this.typing = false;
	}
}

class Message {
	constructor(fromSelf, timeSent, content) {
		this.fromSelf = fromSelf;
		this.timeSent = timeSent;
		this.content = content;
	}
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
readline.emitKeypressEvents(process.stdin);

const terminal = readline.createInterface({
	input: process.stdin, output: process.stdout
});

const question = terminal.question.bind(terminal);

const questionSync = util.promisify((query, callback) => {
	setPrompt(query);
	return question(query, (answer) => callback(null, answer));
});

const qr = util.promisify((input, options, callback) => qrcode.generate(
	input, options, (output) => callback(null, output)
));

qrcode.setErrorLevel("M");

const promptText = "> ";
const helpJoiner = "\n   ";
const passwordChar = "*";
const passwordTimeout = 2000;
const defaultName = "user";
const typingText = "typing...";
const colors = ["default", "red", "green", "yellow", "blue", "magenta", "cyan"];
const welcomeText = "Type \"help\" for a list of commands.";
const headers = ["#", "Name", "Public Key"];
const selfSuffix = " (you)";
const storeDir = `${dataDir}/mesh-client`;
const storeFile = `${storeDir}/store-${localAccount}.mesh`;

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

const countColorCharacters = (text) => (
	text.match(
		/\u001b\[[0-9]*m/g
	).map(
		(match) => match.length
	).reduce(
		(a, b) => a + b, 0
	)
);

const getUserIndex = (indexString) => {
	const index = Number.parseInt(indexString) - 1;
	if (!Number.isInteger(index)) throw new Error();
	return index;
}

const addUser = (user) => {
	users.push(user);
	writeStore();
}

const findUser = (publicKey) => (
	users.find((user) => user.publicKey === publicKey)
);

const addOrUpdateUser = (publicKey, name, color) => {
	let user = findUser(publicKey);
	let oldName, oldColor;

	if (user) {
		oldName = user.name;
		oldColor = user.color;

		user.name = name;
		user.color = color;
	} else {
		user = new User(publicKey, name, color);
		addUser(user);
	}

	if (name !== oldName || color !== oldColor) updatePrompt();

	return user;
}

const commands = {
	"help": () => (
		`Commands:${helpJoiner}${Object.keys(commands).join(helpJoiner)}`
	),
	"add [user key]": async (args) => {
		if (args.length < 1) throw new Error();

		const isWebAddress = args[0].includes(".");

		const publicKey = isWebAddress ? (
			(await (await fetch(`http://${args[0]}/mesh.pub`)).text()).trim()
		) : args[0];

		const name = isWebAddress ? args[0] : defaultName.grey;

		if (!findUser(publicKey)) addUser(new User(publicKey, name, "default"));

		return `Added user with key "${publicKey}".`;
	},
	"remove [user #]": (args) => {
		const index = getUserIndex(args[0]);

		if (index !== 0) {
			if (oldChat === users[index]) oldChat = null;
			users.splice(index, 1);
			writeStore();
			return `Removed user #${args[0]}.`;
		} else {
			return "You cannot remove yourself.";
		}
	},
	"chat [user #]": async (args) => {
		currentChat = users[getUserIndex(args[0])];
		await startChat();
	},
	"unread [user #] [n]": (args) => {
		const n = Number(args[1]);
		if (!Number.isInteger(n)) throw new Error();

		const user = users[getUserIndex(args[0])];
		user.unread = n <= user.history.length ? n : user.history.length;

		writeStore();
		updatePrompt();
	},
	"clipboard [optional user #]": (args) => {
		const user = users[args.length ? getUserIndex(args[0]) : 0];
		clipboard.writeSync(user.publicKey);
		return `Copied ${getColoredUser(user)}’s public key to clipboard.`;
	},
	"qr [optional user #]": async (args) => {
		const user = users[args.length ? getUserIndex(args[0]) : 0];
		const result = await qr(user.publicKey, {small: true});
		return (
			`${result.trim()}\nScan to get ${getColoredUser(user)}’s public key`
		);
	},
	[
		`set name [text]${helpJoiner}set color${helpJoiner}set password`
	]: async (args) => {
		switch (args[0]) {
			case "name":
				users[0].name = args[1].substring(0, mesh.nameMaxLength);
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

		if (["name", "color"].includes(args[0])) {
			users.forEach((user) => {
				if (user.history.filter((message) => message.fromSelf).length) {
					mesh.sendUserUpdate(user.publicKey, {
						name: users[0].name,
						color: users[0].color
					});
				}
			})
		}

		writeStore();

		return `Updated user information.`;
	},
	"nodes": () => `Nodes: ${mesh.getNodes().join(", ")}.`,
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

	users.forEach((user) => user.typing = false);
}

const writeStore = () => {
	if (!fs.existsSync(storeDir)) {
		fs.mkdirSync(storeDir);
	}

	fs.writeFileSync(storeFile, mesh.encrypt(
		JSON.stringify({users, privateKey, list}), password
	));
}

const sortUsers = () => [...users].sort((a, b) => {
	if (a === users[0]) return -1;
	if (b === users[0]) return 1;

	if (a.history.length || b.history.length) {
		if (a.history.length === 0) return 1;
		if (b.history.length === 0) return -1;

		if (a.unread || b.unread) {
			if (a.unread === 0) return 1;
			if (b.unread === 0) return -1;
		}

		const aLastMessage = a.history.slice(-1)[0];
		const bLastMessage = b.history.slice(-1)[0];

		return bLastMessage.timeSent - aLastMessage.timeSent;
	}

	return users.indexOf(a) - users.indexOf(b);
});

const displayUsers = () => {
	const ttyColumns = process.stdout.columns;
	const indexColumnWidth = String(users.length + 1).length;
	let nameColumnWidth = mesh.nameMaxLength + selfSuffix.length;
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

	const sortedUsers = sortUsers();

	return table([
		headers, ...sortedUsers.map((user) => {
			const nameText = (
				(user.unread ? `(${user.unread}) `.red : "")
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

const displayColors = () => {
	print(`Colours: ${colors.map(
		(color) => getColoredText(color, color)
	).join(", ")}`);
}

const clearScreen = (overwrite) => {
	setPrompt("");
	if (!overwrite) print("\n".repeat(process.stdout.rows - 2));
	readline.cursorTo(process.stdout, 0, 0);
	readline.clearScreenDown(process.stdout);
}

const clearLines = (n) => {
	if (n > 0) {
		readline.cursorTo(process.stdout, 0);
		readline.moveCursor(process.stdout, 0, -n);
		readline.clearScreenDown(process.stdout);
	}
}

let lastOutput;

const menu = () => (
	`Connected to ${residence.bold} as ${
		getColoredUser(users[0])}.\n${displayUsers()}\n${lastOutput}\n${promptText
	}`
);

const setPrompt = (text) => {
	terminal.setPrompt(text);
	terminal.prompt(true);
}

const updatePrompt = () => {
	if (showingPrompt) {
		clearScreen(true);
		setPrompt(menu());
	}
}

const prompt = async (output) => {
	lastOutput = output || lastOutput;

	clearScreen(true);

	const input = (await questionSync(menu())).trim();
	if (!showingPrompt) return;

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
				output = `Usage:${
					command.includes(helpJoiner) ? helpJoiner : " "
				}${command}${
					command.includes(helpJoiner) ? "" : "."
				}`;
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

process.stdout.on("resize", updatePrompt);

const displayHistory = () => {
	print(`This is your chat with ${
		getColoredUser(currentChat)
	}. Press Tab to switch.${
		currentChat.history.length === currentChat.unread ? "" : "\n"
	}`);

	print(currentChat.history.map((message, index) => (
		renderUnreadLine(currentChat, index) + renderMessage(
			message.fromSelf ? users[0] : currentChat, message.content
		)
	)).join("\n"));

	currentChat.unread = 0;
	writeStore();
}

const getChatPrompt = () => `${getColoredUser(users[0])}: `;

let chatTempText = null;

const chatUpdate = (tempText, permText) => {
	if (!currentChat) return;

	const lines = [
		...terminal._prompt.split("\n").slice(0, chatTempText ? -2 : -1)
	];

	if (permText) {
		// Assume all the color is in the first wrapped line.
		const firstLineEnd = (
			process.stdout.columns + countColorCharacters(permText)
		);

		const firstLine = permText.substring(0, firstLineEnd);

		const rest = permText.substring(firstLineEnd).match(
			new RegExp(`.{1,${process.stdout.columns}}`, "g")
		) || [];

		lines.push([firstLine, ...rest].join("\n"));
	}

	if (tempText) lines.push(tempText);

	lines.push(getChatPrompt());

	chatTempText = tempText;

	setPrompt(lines.join("\n"));
}

const chatSetTempText = (text) => chatUpdate(text);

const chatInsert = (user, content) => {
	chatUpdate(chatTempText, renderMessage(user, content));
};

const chatSetTyping = (value) => (
	chatSetTempText(value ? renderMessage(currentChat, typingText.grey) : null)
);

const renderMessage = (user, content) => `${getColoredUser(user)}: ${content}`;

const renderUnreadLine = (user, index) => (
	user.unread !== 0 && user.unread === user.history.length - index
	? `${"─".repeat(process.stdout.columns).red}\n` : ""
);

const startChat = async () => {
	showingPrompt = false;
	clearScreen(true);
	displayHistory();
	await chat();
}

let lastSentTyping = 0;
let lastSwitch = 0;

const chat = async () => {
	setImmediate(() => chatSetTyping(currentChat.typing));

	const input = await questionSync(getChatPrompt());
	if (!currentChat) return;

	if (chatTempText) {
		clearLines(2);
		print(getChatPrompt() + input);
	}

	currentChat.history.push(new Message(true, Date.now(), input));

	if (currentChat !== users[0]) {
		mesh.sendMessage(currentChat.publicKey, users[0], input);
		lastSentTyping = 0;
	}

	writeStore();
	chat();
}

const simulateKey = (name) => terminal.write(null, {name});

process.stdin.on("keypress", (_, key) => {
	if (key) {
		if (key.ctrl && key.name === "c") {
			print();
			process.exit();
		}

		if (key.name === "tab" && Date.now() - lastSwitch > 50) {
			if (currentChat) {
				showingPrompt = true;
				oldChat = currentChat;
				currentChat = null;

				simulateKey("enter");

				prompt(`Press Tab to switch back to ${
					getColoredUser(oldChat)
				}.`);
			} else if (oldChat || users.length > 1) {
				if (!oldChat) oldChat = sortUsers()[1];

				showingPrompt = false;
				currentChat = oldChat;

				simulateKey("enter");

				startChat();
			} else {
				simulateKey("backspace");
				return;
			}

			lastSwitch = Date.now();
		} else if (
			currentChat && ![
				"escape", "backspace", "return", "left", "right", "up", "down"
			].includes(key.name)
			&& Date.now() - lastSentTyping > mesh.typingTimeout
			&& currentChat.history.filter((message) => message.fromSelf).length
		) {
			lastSentTyping = Date.now();
			mesh.sendTyping(currentChat.publicKey);
		}
	}
});

const questionColorSync = async () => {
	displayColors();
	const color = await questionSync("Select user colour: ");
	return colors.includes(color) ? color : "default";
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
	print("Connecting...");

	mesh.bootstrap(list, (newResidence) => {
		residence = newResidence;
		prompt(welcomeText);
	});
}

const start = async (noClear) => {
	if (!noClear) clearScreen();

	try {
		readStore();
	} catch (error) {
		password = await questionPasswordSync("Enter password: ");

		try {
			readStore();
		} catch (error) {
			setTimeout(() => {
				print("Sorry, try again.");
				start(true);
			}, passwordTimeout);

			return;
		}
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

let typingTimer = null;

mesh.on("message", (fromKey, timeSent, {user, content}) => {
	const from = addOrUpdateUser(fromKey, user.name, user.color);

	from.history.push(new Message(false, timeSent, content));

	if (currentChat === from) {
		chatSetTempText();
		chatInsert(from, content);
	} else {
		from.unread++;
	}

	from.typing = false;
	clearTimeout(typingTimer);

	writeStore();
	updatePrompt();
});

mesh.on("userUpdate", (fromKey, _, {user}) => {
	addOrUpdateUser(fromKey, user.name, user.color);
});

mesh.on("typing", (fromKey) => {
	const from = findUser(fromKey);

	if (from) {
		from.typing = true;

		if (currentChat === from) chatSetTyping(true);

		// Remove typing text after the typing timeout, with a little padding.
		clearTimeout(typingTimer);
		typingTimer = setTimeout(() => {
			from.typing = false;

			if (currentChat === from) {
				chatSetTempText();
			}
		}, mesh.typingTimeout + 1000);
	}
})

mesh.on("disconnected", () => {
	clearScreen(true);
	print(`Disconnected from ${residence.bold}.`);
	process.exit(1);
})

storeExists() ? start() : setup();

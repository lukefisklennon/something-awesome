const crypto = require("crypto");
const readline = require("readline");
const util = require("util");
const fs = require("fs");

const {table, getBorderCharacters} = require("table");
require("colors");

let users = [];
let privateKey = null;
let password = null;
let currentChat = null;
let awaitingInput = false;

const shell = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

shell.questionSync = util.promisify(shell.question).bind(shell);

const ivLength = 16;
const saltLength = 16;
const cipherKeyLength = 32;
const cipherAlgorithm = `aes-${cipherKeyLength * 8}-cbc-hmac-sha256`;

const helpJoiner = "\n   ";
const passwordChar = "●";
const passwordTimeout = 2000;
const colors = ["default", "red", "green", "yellow", "blue", "magenta", "cyan"];

const getBrightColor = ([first, ...rest]) => (
	`bright${first.toUpperCase() + rest.join("")}`
);

const getColoredText = (text, color) => (
	color === "default" ? text : text[getBrightColor(color)]
);

const welcomeText = () => (
	`Welcome ${getColoredText(users[0].name, users[0].color)}! ` +
	`Type "help" for a list of commands.`
);

const storeDir = (
	process.env.APPDATA || (
		process.platform == "darwin"
		? process.env.HOME + "/Library/Preferences"
		: process.env.HOME + "/.local/share"
	)
) + "/mesh";
const storeFile = `${storeDir}/store.json`;

const commands = {
	"help": () => {
		return (
			`Commands:${helpJoiner}${Object.keys(commands).join(helpJoiner)}.`
		);
	},
	"add [user key]": (args) => {
		users.push({key: args[0], name: "Unknown".grey, color: "default"});
		return `Added user with key "${args[0]}".`;
	},
	"remove [user #]": (args) => {
		const index = Number(args[0]) - 1;
		if (index !== 0) {
			users.splice(index, 1);
			return `Removed user #${args[0]}.`;
		} else {
			return "You cannot remove yourself. Type \"reset\" to logout.";
		}
	},
	"chat [user #]": (args) => {

	},
	[`set name [text]${helpJoiner}set color`]: (args) => {

	},
	"reset": () => {
		fs.rmSync(storeFile);
		setup();
	},
	"exit": () => {
		process.exit();
	}
};

const saltedPassword = (password, salt) => (
	crypto.scryptSync(password, salt, cipherKeyLength)
);

// Adapted from <https://stackoverflow.com/a/60370205/5583289>
const encrypt = (text, password) => {
	const iv = crypto.randomBytes(ivLength);
	const salt = crypto.randomBytes(saltLength);
	const key = saltedPassword(password, salt);
	const cipher = crypto.createCipheriv(cipherAlgorithm, key, iv);

	let encrypted = cipher.update(text);
	encrypted = Buffer.concat([encrypted, cipher.final()]);

	return [iv, salt, encrypted].map((x) => (x).toString("hex")).join(":");
}

// Adapted from <https://stackoverflow.com/a/60370205/5583289>
const decrypt = (text, password) => {
	const [iv, salt, encrypted] = text.split(":").map(
		(x) => Buffer.from(x, "hex")
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

const onInput = (input) => {
	const args = input.split(" ");

	for (let command in commands) {
		if (command.split(" ")[0] === args[0].toLowerCase()) {
			awaitInput(commands[command](args.slice(1)));
			return;
		}
	}

	awaitInput(`Unknown command "${args[0]}". ${welcomeText}`);
}

const listUsers = () => {
	let output;
	const config = {
		border: getBorderCharacters("norc"),
		drawHorizontalLine: (index, size) => [0, 1, 2, size].includes(index)
	};

	if (users.length === 0) {
		config.columns = {0: {width: welcomeText.length - 4}};
		output = table([["No users added yet."]], config);
	} else {
		output = table([
			["#", "Name", "Key"],
			...users.map((user, index) => (
				[index + 1, getColoredText(user.name, user.color), user.key]
			))
		], config);
	}

	console.log(output.trim());
}

const listColors = () => {
	console.log(`Colours: ${colors.map(
		(color) => getColoredText(color, color)
	).join(", ")}`);
}

const clearScreen = () => {
	console.log("\n".repeat(process.stdout.rows));
	readline.cursorTo(process.stdout, 0, 0);
	readline.clearScreenDown(process.stdout);
}

// const clearLine = () => {
// 	readline.cursorTo(process.stdout, 0);
// 	readline.moveCursor(process.stdout, 0, -1);
// }

const awaitInput = (lastOutput) => {
	if (!awaitingInput) return;
	lastOutput = lastOutput || welcomeText();

	clearScreen();
	listUsers();
	console.log(lastOutput);
	shell.question("> ", onInput);
}

const questionPasswordSync = async (prompt) => {
	const old_writeToOutput = shell._writeToOutput;

	shell._writeToOutput = (string) => {
		if (string.trim().length === 0) {
			shell.output.write(string);
			return;
		}

		const split = string.split(prompt);

		if (split.length === 2) {
			split[1] = passwordChar.repeat(split[1].length);
		} else {
			split[0] = passwordChar;
		}

		shell.output.write(split.join(prompt));
	};

	const input = await shell.questionSync(prompt);
	shell._writeToOutput = old_writeToOutput;
	return input;
}

const start = async () => {
	password = await questionPasswordSync("Enter password: ");
	const error = readStore();

	if (error === "ERR_OSSL_EVP_BAD_DECRYPT") {
		setTimeout(() => {
			console.log("Sorry, try again.");
			start();
		}, passwordTimeout);
	} else {
		awaitingInput = true;
		awaitInput();
	}
}

const setup = async () => {
	awaitingInput = false;
	clearScreen();

	const name = await shell.questionSync("Set username: ");
	listColors();
	const color = await shell.questionSync("Select user colour: ") || "default";
	password = await questionPasswordSync("Set password: ")

	users[0] = {key: "abc", name, color};
	privateKey = "def";
	writeStore();

	awaitingInput = true;
	awaitInput();
}

storeExists() ? start() : setup();

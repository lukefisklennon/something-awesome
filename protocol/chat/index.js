const CoreProtocol = require("../core/client");

module.exports = class MeshClient extends CoreProtocol {
	constructor() {
		super();

		this.nameMaxLength = 16;
		this.typingTimeout = 5000;

		this.on("receive", this.chatOnReceive.bind(this));
	}

	sendMessage(to, user, content) {
		this.chatSend(to, "message", {user, content});
	}

	sendUserUpdate(to, user) {
		this.chatSend(to, "userUpdate", {user});
	}

	sendTyping(to) {
		this.chatSend(to, "typing");
	}

	chatSend(to, event, data) {
		data = data || {};
		this.send(to, JSON.stringify([event, data]));
	}

	chatOnReceive(from, timeSent, content) {
		const [event, data] = JSON.parse(content);
		this.emit(event, from, timeSent, data);
	}
}
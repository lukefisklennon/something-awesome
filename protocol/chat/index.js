const CoreProtocol = require("../core/client");

module.exports = class MeshClient extends CoreProtocol {
	constructor() {
		super();

		this.nameMaxLength = 16;
		this.typingTimeout = 5000;

		this.on("receive", this.chatOnReceive.bind(this));
		this.on("ack", this.chatOnAck.bind(this));
	}

	sendMessage(to, user, content) {
		return this.chatSend(to, true, "message", {user, content});
	}

	sendUserUpdate(to, user) {
		this.chatSend(to, false, "userUpdate", {user});
	}

	sendTyping(to) {
		this.chatSend(to, false, "typing");
	}

	chatSend(to, requiresAck, event, data) {
		data = data || {};
		return this.send(to, false, requiresAck, JSON.stringify([event, data]));
	}

	chatOnReceive(id, from, timeSent, content) {
		const [event, data] = JSON.parse(content);
		this.emit(event, id, from, timeSent, data);
	}

	chatOnAck(from, timeSent, id) {
		this.emit("messageAck", from, timeSent, id);
	}
}
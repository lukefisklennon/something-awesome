# Mesh

Mesh is a decentralised, encrypted chat protocol. It allows users to send instant messages across a network of crowdsourced servers, which store and deliver messages to users who encrypt and authenticate them end-to-end.

The advantage of such a protocol is that people can communicate in complete privacy, and without relying on centralised servers. This gives more power to the users, and improves scalability of the system (see Signal's issues after [Elon Musk tweeted](https://twitter.com/elonmusk/status/1347165127036977153)).

It also takes the federated model (e.g. email) further by untethering user identity from an authoritative server. This is achieved by addressing users by their public keys, which are short enough thanks to elliptic curve cryptography. Also, unlike with P2P, Mesh can deliver messages while both users in an exchange are offline.

## Overview

The main focus of this project is the protocol design and its prototype implementation, which will be in JavaScript. A simple terminal frontend will allow a user to send and receive messages. In reality, this would usually occur through a mobile or desktop app.

Mesh essentially works by providing a distributed hash table of message queues, featuring a simple complete network topology, and consistent hashing. The system should be resilient to an unreliable server infrastructure, would be crowdsourced from members of the community.

### Server discovery

Any node or user of the network discovers the whole network through a [bootstrapping process](#bootstrapping). Knowledge of only one server address (or domain name) is required, as the list can be updated by contacting those known nodes. Through this process, all servers reach a consensus about what nodes exist in the network.

Once an end-user is bootstrapped, they choose a [residence server](#residence), which provides a channel for communicating with other users. This selection process is known as consistent hashing, whereby a user's hashed public key and each server's hashed address are compared in a [cicular hash-space](#hash-space).

A user's residence server is the node which is most proximal in hash-space. Because consistent hashing is deterministic, two users can both reach consensus on their residences before ever communicating. This method is also reasonably uniform but unpredictable, providing scalability through load balancing, and preventing a node from rigging its hash-space location.

A user maintains a persistent, full-duplex connection with their residence server. For this prototype, mainly the application-layer protocol [WebSocket](#websocket-communication) will be used, which is TCP-like and message-based.

### Message delivery

To send a message, a user transmits it to their residence server. The server then determines the recipient's residence server in the network, and [forwards it](#server-to-server-communication). Once received, it is placed in a message queue assigned to the recipient.

The recipient does not have to be online to receive a message. The queue is maintained until the recipient reconnects, at which time that data is dumped to the recipient, and deleted from the queue. In this way, clients should maintain their own long-term storage of message history, but servers provide a shorter-term cache to facilitate asynchronous messaging.

### Encryption

Because the Mesh network is an untrusted medium, and due to a lack of centralised identity management, users must handle encryption and authentication independently. When a user is created, they [generate](#keys-and-addressing) an Elliptic Curve Diffie-Hellman (ECDH) keypair. The public key is also used as their user ID, so EC has been chosen due to its economical key sizes.

Before a message can be sent, a shared secret is generated with the ECDH algorithm. Each user only requires the public key of the other to do so, meaning this secret is never transmitted. Once the secret has been created, the message is encrypted and sent over the network. The recipient then decrypts it, and can be assured that it is both confidential and genuine.

## Core protocol

This part of the protocol provides general functionality, which is not specific to a particular service. In this way, it is distinct from the overlying chat protocol. The specification includes addressing, server discovery, and event-based delivery. It currently does not support storing permanent data.

### Keys and addressing

Each new user generates their own ECDH keypair with the *secp256k1* curve. The public and private key sizes are 33 bytes and 32 bytes, respectively. The public key is that user's permanent address. This key usually should be presented to humans as a Base58-encoded string, or some other representation of that (such as a QR code).

Servers also generate their own ECDH keypairs in the same way as users, but these are instead used for authenticating users. The purpose is to defend against denial-of-service attacks, not to ensure confidentiality. This is because servers usually delete messages once they are delivered, so an attacker could prevent genuine users from receiving messages.

### Hash-space

User IDs (public keys) and server IDs (domain names or IP addresses) are mapped into a shared circular hash-space with SHA3-256. The proximity between two objects is defined as either their hash difference, or the domain size minus their hash difference – whichever is smallest. For example, two objects at the very edges of non-circular hash-space are considered to be at the same location in the circular representation.

### Network topology

<img src="topology.png" width="240">

The core network of servers is interconnected as a complete graph, for the simplicity of this prototype. These are [long-lived WebSocket connections](#server-to-server-communication). Any change to the network structure, such as a node joining or leaving, is detected by all nodes immediately.

Around this core, users connect to a single node with a [similar WebSocket connection](#client-to-server-communication). The node chosen is known as the [residence server](#residence).
### Server list format

The list of servers is transmitted as UTF-8 text. Each entry is in the format `address:port`, where `address` is a domain name or IP address. IPv6 addresses are wrapped with brackets (`[]`), to avoid ambiguity with the port number.

Each entry is separated by a newline and/or carriage return character. The trailing line separator is optional. Additional whitespace (per Unicode) should be ignored.

### Bootstrapping

New users and servers should have at least a partial list of servers provided to them, usually bundled with the application or library implementing the protocol. Before a user chooses a residence, this list must be updated to the latest version.

Servers provide an HTTP GET endpoint `/discover` which serves the list. This is the only HTTP endpoint, as most communication is conducted over WebSocket. Both users and servers should permanently store this list (e.g. on hard disk), for quicker bootstrapping should a restart occur.

### Residence

While servers establish WebSocket communication to every server, users choose one as their residence. This server is the node closest to the user in hash-space. Users may also poll the `/discover` endpoint of non-residence servers periodically to strengthen their confidence in the list.

In the case that residence has already been established, but a new server has joined the network in closer hash-space proximity to the user, that user migrates to the new server. However, it is advisable to fetch any remaining messages from the old residence before doing so.

### Message forwarding and queues

Upon receiving a user's message, a sender's residence server immediately forwards it to the recipient's residence. Upon the recipient's residence receiving it, that message is forwarded to the recipient if they are online and authenticated. The authentication process is described in [client-to-server communication](#client-to-server-communication).

However, if the recipient is offline, the message is stored in a queue assigned to that user. The queue should be stored permanently (e.g. on hard disk), and for as long as practical. Once a client comes online and is authenticated, each message in the queue should be sent individually and in order, until the queue is empty.

### Message encryption and reliability

To send a message to another user, the plaintext is first encrypted with a shared secret. This secret is generated with the ECDH algorithm, using the user's own keypair and the public key of the recipient. The format of plaintext messages is described by the overlying [chat protocol](#chat-protocol).

Some messages require acknowledgement, as determined by the chat protocol. An acknowledgement message contains the hash of the plaintext message. The state of requiring or being an acknowledgement is signalled in the message metadata, not the plaintext, and is described in [client-to-server communication](#client-to-server-communication).

### WebSocket communication

All communication via WebSocket is event-driven and encoded with UTF-8 JSON. All messages should follow this format:

```
["eventType", {key: value, ...}]
```

The first item of this array, the event name, is required and a string. By convention, it should be written in camel case.

The second item, the payload, is optional. Its omission is equivalent to `{}`. If included, it must be an object. The number, values, and depth of these items is unconstrained. However, camel-case keys are conventional.

### Server-to-server communication

All servers connect to each other and are considered equals in these connections, unlike with [client-to-server communication](#client-to-server-communication). However, establishing a WebSocket connection requires a notion of clients and servers (with clients initiating connections).

The server that was running first is considered the server for this purpose. So, a new node joining the network is a client to all the other servers. However, it possible that two connections are established at once between nodes. This may happen if both start at the same time, or a known server reconnects to the network.

This is resolved by setting the node greater in hash-space as the server, meaning that the connection where that node is client is closed.

Once the connection is established, these event types may be sent:

- "discover": `{list: string}`
  - `list` is in the [server list format](#server-list-format)
  - sent by both nodes immediately after connecting
  - upon receiving the list, a node merges it into their own (i.e. concatenating and removing duplicates)
  - connections are established with any new servers in the list
- "send": `{hash: string, to: string, from: string, timeSent: integer, isAck: boolean, requiresAck: boolean, content: string}`
  - `to` and `from` are the public keys of the sender and recipient, respectively
  - `timeSent` is a Unix timestamp in milliseconds
  - `isAck` signifies if the message is an acknowledgement for another message, and `content` is an encrypted hash of the original decrypted message
  - `requiresAck` signifies if a response message (with `isAck` true) is expected, and is always false if `isAck` is true
  - `content` is a Base64-encoded string representing an encrypted payload
  - used by servers to forward a user's message

Upon disconnection, the disconnected node is removed from the server lists stored by active nodes.

### Client-to-server communication

Users establish a connection as a client with their residence server. The following event types may be sent:

- Server-to-client
  - "whoami": `{publicKey: string}`
    - `publicKey` is the server's public key
    - allows the client to then authenticate
  - "discover": see "discover" in [server communication](#server-to-server-communication)
    - sent on connection, and additionally whenever the server's list is updated
  - "receive": see "send" in [server communication](#server-to-server-communication)
    - delivers a message addressed to the client
- Client-to-server
  - "auth": `{publicKey: string, proof: string}`
    - `publicKey` is the client's public key
    - `proof` is the client's public key encrypted with the ECDH shared secret, which can be derived from the server's public key (sent with "whoami") and the client's keypair
    - the server can then decrypt `proof` to authenticate the client, making the server willing to send messages and delete its own copy of them
  - "send": see "send" in [server communication](#server-to-server-communication)


## Chat protocol

This protocol contains the specifics of events needed by a chat service, like messaging, user data, and typing notifications. It is facilitated by the underlying core protocol.

### User data

Each user has a set of self-determined metadata in the following UTF-8 JSON format:

```
{name: string, color: string}
```

Both of these attributes are optional, and may be ignored by clients while displaying a user representation. If `color` is included, it must be `red`, `green`, `yellow`, `blue`, `magenta`, or `cyan`.

### Events

Like described in the core protocol, all events are sent in this UTF-8 JSON format:

```
["eventType", {key: value, ...}]
```

For more details, see the relevant [core protocol section](#websocket-communication).

The following event types may be sent:

- "message": `{user: object, content: string}`
  - `user`: see the [section on user data](#user-data)
  - `content`: a plaintext message (no formatting data)
- "typing"
  - sent when a user starts typing
  - sent again every 5 seconds while they are still typing
- "userUpdate": `{user: object}`
  - `user`: see the [section on user data](#user-data)
  - sent when a user's data is updated
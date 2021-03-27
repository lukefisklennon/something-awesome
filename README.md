# Mesh

Mesh is a decentralised, encrypted chat protocol. It allows users to send instant messages across a network of crowdsourced servers, which store and deliver messages to users who encrypt and sign them end-to-end.

The advantage of such a protocol is that people can communicate in complete privacy, and without relying on centralised servers. This gives more power to the users, and better scalability for the whole system (see Signal's issues after [Elon Musk tweeted](https://twitter.com/elonmusk/status/1347165127036977153)).

It also takes the federated model (e.g. email) further by untethering user identity from an authoritative server. This is achieved by having users addressed by their public keys, which are short enough thanks to elliptic curve cryptography (ECC). However, unlike with P2P, Mesh can deliver messages while both users in an exchange are offline.

## Overview

The main focus of this project is the protocol design and its prototype implementation, which will be in JavaScript due to my familiarity with that language. A simple terminal frontend will allow a user to send and receive messages. In reality, this would probably occur through a mobile app.

Mesh essentially works by providing a distributed hash table of message queues, featuring a simple complete network overlay topology, and consistent hashing. Servers would be provided by technical-minded members of the community.

### Server discovery

Any node or user of the network discovers the whole network through a bootstrapping process. Knowledge of only one server address (or domain name) is required, as the list can be updated by contacting those known nodes. Through this process, all servers reach a consensus about what nodes exist in the network.

Once an end-user is bootstrapped, they choose a residence server, which provides a channel for communicating with other users. This selection process is known as consistent hashing, whereby a user's identifier and each server's hashed address are compared in a cicular keyspace.

A user's residence server is the node which is most proximal in this keyspace. Because consistent hashing is deterministic, two users can both reach agreement on their residences before ever communicating. This method is also reasonably uniform and unpredictable, preventing a server from rigging its keyspace location, and providing scalability through load balancing.

A user maintains a persistent, full-duplex connection with their residence server. For this prototype, the application-layer protocol WebSocket will be used, which is TCP-like but also event-driven.

### Message delivery

To send a message, a user emits it to their residence server. The server then determines the recipient's residence server in the network, and forwards it. Once received, it is placed in a message queue assigned to the recipient. These queues are essentially what the keys (user identifiers) map to in a distributed hash table.

The recipient does not have to be online to receive this message. The queue is maintained until the recipient reconnects, at which time that data is dumped to the recipient, and deleted from the queue. In this way, clients maintain their own long-term storage of message history, but servers provide short-term storage to facilitate asynchronous messaging.

### Encryption

Because the Mesh network is an untrusted medium, and due to a lack of centralised identity management, users must handle encryption and authentication independently. When a user is created, they generate an Elliptic Curve Diffie-Hellman (ECDH) keypair. The public key is also used as their user identifier, so EC has been chosen due to its economical key sizes.

Before a message can be sent, a shared secret is generated with the ECDH algorithm. Each user only requires the public key of the other to do so, meaning this secret is never transmitted. Once the secret has been created, the message is encrypted with it and sent over the network. The recipient then decrypts it, and can be assured of who sent it and that no one else can read it.

### Protocols

Mesh is made up of two parts, the core and chat protocols. The core isn't specific to a single service, rather providing general functionality like server discovery, message (in the general sense) delivery. Meanwhile, the chat protocol contains the specifics of events needed by a chat service, like message metadata, user info, and typing events.

## Core protocol

### Keys and addressing

Each new user generates their own ECDH keypair with the `secp256k1` curve. The public and private key sizes are 33 bytes and 32 bytes, respectively. The public key is that user's permanent identifier.

# Mesh.im

Mesh is a decentralised, encrypted chat protocol. It allows users to send instant messages without a dedicated server, or tying their identity to a server (unlike with federated protocols such as Mastodon). Instead, crowdsourced servers store and deliver messages across the network, with recipients decrypting data and verifying its authenticity with their own keys.

The advantage of such a protocol is that people can communicate in complete privacy, and without relying on centralised servers. This gives more power to the users, and better scalability for the whole system (see Signal's issues after Elon Musk tweeted). It can also deliver messages while both users in an exchange are offline, unlike with P2P.

## Overview

The main focus of this project is the protocol design and its implementation, which will be in JavaScript due to my familiarity with that language. A simple terminal frontend allows a user to send and receive messages. In reality, this would probably occur through a mobile app.

Mesh is made up of two parts, the core protocol and the chat protocol. The core isn't specific to a chat service, rather providing general functionality like server discovery, key exchange, and message (in the general sense) delivery. Meanwhile, the chat protocol contains the specifics of events needed by a chat service, like message metadata, user info, and typing events.

## Process

https://safecurves.cr.yp.to/

## Core protocol

In the interest of simplicity, the Mesh protocol will be built on top of two application-layer protocols: HTTP and WebSocket. The latter of these provides long-lived, bidirectional, full-duplex communication, allowing a server to push messages directly to clients.
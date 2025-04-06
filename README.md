# VibeBurst Backend

This is the backend server for the VibeBurst real-time chat application. It handles WebSocket connections and implements a real-time random matching system.

## Features

- Real-time WebSocket communication
- Random user matching based on language and interests
- Match acceptance/rejection system
- Automatic re-matching when a match is rejected
- Unique chat rooms for matched users
- Anonymous mode to hide user profile information

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory with the following variables:
```
PORT=3001
NODE_ENV=development
```

3. Start the server:
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

## WebSocket Events

### Client to Server

1. `register`
   - Registers a new user with their preferences
   - Payload: `{ userId, language, interests, isAnonymous }`
   - `isAnonymous`: Boolean flag to enable anonymous mode (hides profile information)

2. `requestMatch`
   - Requests a new match for the user
   - No payload required

3. `matchResponse`
   - Responds to a match proposal
   - Payload: `{ accepted: boolean, matchId: string }`

4. `joinRoom`
   - Joins a chat room
   - Payload: `{ roomId: string }`

5. `message`
   - Sends a chat message
   - Payload: `{ roomId: string, message: { id, text, userId, timestamp, isAnonymous } }`

### Server to Client

1. `matchProposed`
   - Sent when a potential match is found
   - Payload: `{ matchId: string, isAnonymous: boolean }`
   - `isAnonymous`: Indicates if the potential match is in anonymous mode

2. `matchSuccess`
   - Sent when both users accept the match
   - Payload: `{ roomId: string, users: [{ userId: string, isAnonymous: boolean }, { userId: string, isAnonymous: boolean }] }`
   - `isAnonymous`: Indicates if each user is in anonymous mode

3. `matchRejected`
   - Sent when the other user rejects the match
   - No payload

4. `message`
   - Sent when a new message is received
   - Payload: `{ id, text, userId, timestamp, isAnonymous }`
   - `isAnonymous`: Indicates if the message sender is in anonymous mode

## Anonymous Mode

When a user enables anonymous mode:
- Their profile information (name and photo) will be hidden from chat partners
- The chat partner will see a generic "Anonymous User" placeholder instead
- The user's language and interests are still used for matching
- The anonymous status is communicated to potential matches before they accept

## Error Handling

The server includes basic error handling for:
- Invalid user data
- Disconnected users
- Failed matches
- Queue management

## Security

- CORS is enabled for development
- Environment variables for configuration
- Input validation for user data 
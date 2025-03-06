# Learn Pathway Widget

A server-rendered widget that displays a user's learning pathway and course progress. The widget is served directly from an Express server without a separate React frontend.

## Project Structure

- `server.js` - Express server that handles API requests and serves the HTML widget
- `vercel.json` - Vercel deployment configuration
- `.env` - Environment variables (Google Sheets credentials, etc.)
- Package files (`package.json`, `package-lock.json`, `.npmrc`) - Node.js dependencies

## Tech Stack

- Express.js - Server
- Google Sheets API - Data storage
- Vanilla JavaScript - Client-side interactivity
- HTML/CSS - Widget rendering

## API Endpoints

- `/roadmap/:userId` - Get the HTML widget for a specific user
- `/api/roadmap/:userId` - Get a user's saved courses (JSON)
- `/api/roadmap/:userId/add` - Add a course to a user's roadmap
- `/api/roadmap/:userId/update` - Update a course's progress
- `/api/roadmap/:userId/remove` - Remove a course from a user's roadmap

## Setup and Development

1. Install dependencies:
```
npm install
```

2. Set up environment variables in `.env`

3. Run the server:
```
node server.js
```

## Project info

**URL**: https://lovable.dev/projects/7bd64070-e57e-4731-9fe8-476a64f19c2a

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/7bd64070-e57e-4731-9fe8-476a64f19c2a) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/7bd64070-e57e-4731-9fe8-476a64f19c2a) and click on Share -> Publish.

## I want to use a custom domain - is that possible?

We don't support custom domains (yet). If you want to deploy your project under your own domain then we recommend using Netlify. Visit our docs for more details: [Custom domains](https://docs.lovable.dev/tips-tricks/custom-domain/)

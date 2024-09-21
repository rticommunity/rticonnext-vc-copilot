/*******************************************************************************
 * (c) Copyright, Real-Time Innovations, 2024.
 * All rights reserved.
 * No duplications, whole or partial, manual or electronic, may be made
 * without express written permission.  Any such copies, or
 * revisions thereof, must display this notice unaltered.
 * This code contains trade secrets of Real-Time Innovations, Inc.
 */

import * as vscode from 'vscode';
import fetch from 'node-fetch';
import io from "socket.io-client";
import { Socket } from "socket.io-client";
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';

class GlobalState {
    readonly connextProduct: string;
    readonly connextUsernameKey: string;
    readonly connextPasswordKey: string;
    readonly connextIntelligenceUrl: string;
    readonly connextAuth0Url: string;

    extensionUri: vscode.Uri;
    accessCode: string | undefined;
    storedUsername: string | undefined;
    storedPassword: string | undefined;

    socket: Socket | undefined;
    connectionReady: boolean;

    constructor() {
        // Set to displayName
        this.connextProduct = "Connext for Github Copilot";
        this.connextUsernameKey = "connextUsername";
        this.connextPasswordKey = "connextPassword";
        this.connextIntelligenceUrl = "wss://sandbox-chatbot.rti.com";
        this.connextAuth0Url = "https://dev-6pfajgsd68a3srda.us.auth0.com";

        this.accessCode = undefined;
        this.storedUsername = undefined;
        this.storedPassword = undefined;
        this.extensionUri = vscode.Uri.parse(''); // Placeholder value, update when valid value is available

        this.socket = undefined;
        this.connectionReady = false;
    }
}

declare global {
    var globalState: GlobalState;
}

globalThis.globalState = new GlobalState();

interface Secrets {
    clientId: string;
    clientSecret: string;
}

/**
 * Asynchronously reads a JSON file and extracts the clientId and clientSecret
 * needed to get the access token using a password grant. Note that even 
 * though the client ID and client secret are stored in a JSON file in 
 * plaintext, the user cannot get a token without a username and password.
 *
 * @param filePath - The path to the JSON file containing the secrets.
 * @returns A promise that resolves with the extracted secrets.
 *
 * @throws Will reject the promise with an error message if there is an issue reading the file or parsing the JSON.
 *
 * @example
 * ```typescript
 * getSecrets('/path/to/secrets.json')
 *   .then(secrets => {
 *     console.log(secrets.clientId);
 *     console.log(secrets.clientSecret);
 *   })
 *   .catch(error => {
 *     console.error(error);
 *   });
 * ```
 */
async function getSecrets(filePath: string): Promise<Secrets> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                return reject('Error reading file: ' + err);
            }

            try {
                // Parse the JSON data
                const secrets = JSON.parse(data);

                // Extract the secrets
                const clientId = secrets.BOT_API_CLIENT_ID.value;
                const clientSecret = secrets.BOT_API_CLIENT_SECRET.value;

                // Resolve with the extracted secrets
                resolve({ clientId, clientSecret });
            } catch (parseError) {
                reject('Error parsing JSON: ' + parseError);
            }
        });
    });
}

/**
 * Makes an HTTP request to the specified URI with the given options.
 * 
 * @param uri - The URI to make the request to.
 * @param options - The options for the request.
 * @returns A promise that resolves to the response data as a string.
 * @throws If an error occurs during the request.
 */
async function makeHttpRequest(uri: string, options: fetch.RequestInit): Promise<any> {
    try {
        const response = await fetch(uri, options);
        const data = await response.json(); // Parse the JSON response
        return data;
    } catch (error) {
        vscode.window.showErrorMessage(`${globalThis.globalState.connextProduct}: Error making HTTP request: ${error}`)
        throw error;
    }
}

/**
 * Generates a unique request ID.
 *
 * @returns {string} A unique request ID.
 */
function generateRequestId(): string {
    /**
     * Generate a request ID
     */
    return uuidv4();
}

/**
 * Waits for a specified condition to become true within a given timeout period.
 *
 * @param condition - A function that returns a boolean indicating whether the condition is met.
 * @param timeout - The maximum time to wait for the condition to be met, in milliseconds. Defaults to 10000 ms.
 * @param checkInterval - The interval at which to check the condition, in milliseconds. Defaults to 10 ms.
 * @returns A promise that resolves when the condition is met or the timeout is reached.
 */
async function waitForCondition(
    condition: () => boolean, 
    timeout: number = 10000, 
    checkInterval: number = 10
): Promise<void> {
    const startTime = Date.now();

    while (!condition()) {
        if (Date.now() - startTime > timeout) {
            break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
}

/**
 * Retrieves the prompt for the user including chat history.
 * 
 * @param prompt - The prompt to be retrieved.
 * @param context - The chat context containing the history of previous messages.
 * @returns The prompt with the chat history.
 */
function getPrompt(prompt: string, context: vscode.ChatContext): string {
    let previousMessages = context.history;
    let strContext = "";
    const editor = vscode.window.activeTextEditor;

    for (let i = 0; i < previousMessages.length; i++) {
        if (previousMessages[i] instanceof vscode.ChatRequestTurn) {
            const turn = previousMessages[i] as vscode.ChatRequestTurn;
            strContext += `User ask: [[${turn.prompt}]]\n`
        } else if (previousMessages[i] instanceof vscode.ChatResponseTurn) {
            const turn = previousMessages[i] as vscode.ChatResponseTurn;

            strContext += `Bot response: [[\n`
            for (let i = 0; i < turn.response.length; i++) {
                const responsePart = turn.response[i].value;

                if (responsePart instanceof vscode.MarkdownString) {
                    strContext += `${responsePart.value}\n`
                }
            }
            strContext += `]]\n`
        }
    }

    if (editor) {
        const selection = editor.selection;
        const text = editor.document.getText(selection);
        if (text) {
            strContext += `User ask: Given the following text selection answer a question\n`
            strContext += `Text selection begin {{\n`
            strContext += `${text}\n`
            strContext += `}} Text selection end\n`
            strContext += `Question: ${prompt}\n`
        } else {
            strContext += `User ask: ${prompt}\n`
        }
    } else {
        strContext += `User ask: ${prompt}\n`
    }

    return strContext;
}

/**
 * Activates the extension.
 * 
 * This method is called when your extension is activated
 * Your extension is activated the very first time the command is executed.
 * 
 * @param context - The extension context provided by VS Code.
 * 
 * This function registers several commands for the extension:
 * - `connext-vc-copilot.login`: Prompts the user for a username and password, stores them in the global state, and displays a welcome message.
 * - `connext-vc-copilot.logout`: Clears the stored username and password from the global state and displays a confirmation message.
 * - `connext-vc-copilot.explain`: Opens the chat with a prompt to explain the code.
 * - `connext-vc-copilot.fix`: Opens the chat with a prompt to fix the code.
 * 
 * It also creates a chat participant for handling user queries and interacting with the Connext Intelligence Platform.
 */
export function activate(context: vscode.ExtensionContext) {
    globalThis.globalState.extensionUri = context.extensionUri;

    // Register the 'connext-vc-copilot.login' command
    let cidpLogin = vscode.commands.registerCommand('connext-vc-copilot.login', async () => {

        // Check if username and password are already stored
        const storedUsername = context.globalState.get<string>(globalThis.globalState.connextUsernameKey);
        const storedPassword = context.globalState.get<string>(globalThis.globalState.connextPasswordKey);

        if (!storedUsername || !storedPassword) {
            // Ask for username if not stored
            const username = await vscode.window.showInputBox({
                prompt: 'Enter your username',
                placeHolder: 'Username',
                ignoreFocusOut: true,
            });

            // Ask for password if not stored
            const password = await vscode.window.showInputBox({
                prompt: 'Enter your password',
                placeHolder: 'Password',
                password: true, // This will hide the password input
                ignoreFocusOut: true,
            });

            // Check if user provided both credentials
            if (username && password) {
                // Store credentials in global state
                await context.globalState.update(globalThis.globalState.connextUsernameKey, username);
                await context.globalState.update(globalThis.globalState.connextPasswordKey, password);
                vscode.window.showInformationMessage(`${globalThis.globalState.connextProduct}: Credentials saved for user: ${username}`);
            } else {
                vscode.window.showErrorMessage(`${globalThis.globalState.connextProduct}: Both username and password are required.`);
                return false;
            }

            globalThis.globalState.storedUsername = username;
            globalThis.globalState.storedPassword = password;
        } else {
            globalThis.globalState.storedUsername = storedUsername;
            globalThis.globalState.storedPassword = storedPassword;

            // If credentials already exist, display a confirmation message
            vscode.window.showInformationMessage(`${globalThis.globalState.connextProduct}: Welcome back, ${storedUsername}!`);
        }

        return true;
    });

    context.subscriptions.push(cidpLogin);

    // Register the 'github.copilot-chat.logout' command
    let cidpLogout = vscode.commands.registerCommand('connext-vc-copilot.logout', async () => {
        await context.globalState.update(globalThis.globalState.connextUsernameKey, undefined);
        globalThis.globalState.storedUsername = undefined;
        await context.globalState.update(globalThis.globalState.connextPasswordKey, undefined);
        globalThis.globalState.storedPassword = undefined;
        globalThis.globalState.accessCode = undefined
        vscode.window.showInformationMessage(`${globalThis.globalState.connextProduct}: Credentials have been cleared.`);
    });

    context.subscriptions.push(cidpLogout);

    // Explain with Connext
    vscode.commands.registerCommand('connext-vc-copilot.explain', async () => {
        vscode.commands.executeCommand('workbench.action.chat.open', '@connext explain this code');
    });

    // Fix with Connext
    vscode.commands.registerCommand('connext-vc-copilot.fix', async () => {
        vscode.commands.executeCommand('workbench.action.chat.open', '@connext fix this code');
    });

    globalThis.globalState.storedUsername = context.globalState.get<string>(globalThis.globalState.connextUsernameKey);
    globalThis.globalState.storedPassword = context.globalState.get<string>(globalThis.globalState.connextPasswordKey);

    // Create a Copilot chat participant
    const chat = vscode.chat.createChatParticipant("connext-vc-copilot.chat", async (request, context, response, token) => {
        const userQuery = request.prompt;

        if (globalThis.globalState.storedUsername === undefined || globalThis.globalState.storedPassword === undefined) {
            var success = await vscode.commands.executeCommand('connext-vc-copilot.login');

            if (!success) {
                vscode.window.showInformationMessage(`Please log in to ${globalThis.globalState.connextProduct} to continue.`);
                return;
            }
        }

        if (globalThis.globalState.accessCode === undefined) {
            // Get secrets
            const filePath = vscode.Uri.joinPath(globalThis.globalState.extensionUri, 'secrets.json').fsPath;
            const { clientId, clientSecret } = await getSecrets(filePath);

            // Get access token
            const uri = globalThis.globalState.connextAuth0Url + '/oauth/token';
            const jsonPayload = {
                grant_type: 'password',
                username: globalThis.globalState.storedUsername,
                password: globalThis.globalState.storedPassword,
                audience: 'https://chatbot.rti.com/api/v1',
                scope: 'ask:question session:create session:delete session:update',
                client_id: clientId,
                client_secret: clientSecret
            };
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(jsonPayload)
            };

            const jsonResponse = await makeHttpRequest(uri, options)

            if (jsonResponse.error) {
                vscode.window.showErrorMessage(`${globalThis.globalState.connextProduct}: Error getting access token: ${jsonResponse.error_description}`);
                return;
            }

            globalThis.globalState.accessCode = jsonResponse.access_token;
        }

        let socket;

        if (globalThis.globalState.socket == undefined || !globalThis.globalState.connectionReady) {
            globalThis.globalState.socket = io(globalThis.globalState.connextIntelligenceUrl, {
                extraHeaders: {
                    authorization: `bearer ${globalThis.globalState.accessCode}`
                },
                reconnectionAttempts: 3,
            });

            socket = globalThis.globalState.socket;

            socket.on("connect", () => {
                globalThis.globalState.connectionReady = true;
            });
    
            socket.on("disconnect", () => {
                globalThis.globalState.connectionReady = false;
            });

            socket.on('connect_error', (err: Error) => {
                if (err.message != "") {
                    vscode.window.showErrorMessage(`Error connecting to ${globalThis.globalState.connextProduct} Socket.IO server: ${err}`)
                } else {
                    vscode.window.showErrorMessage(`Error connecting to ${globalThis.globalState.connextProduct} Socket.IO server`)
                }
            });

            await waitForCondition(() => globalThis.globalState.connectionReady, 10000, 10);
    
            if (!globalThis.globalState.connectionReady) {
                vscode.window.showErrorMessage(`${globalThis.globalState.connextProduct}: Connection to the server failed.`);
                return;
            }
        } else {
            socket = globalThis.globalState.socket;
        }
        
        let responseReceived = false;

        socket.on('response', (data: string) => {
            // Convert the data (received as a JSON string) to an object
            let parsedData;

            try {
                parsedData = JSON.parse(data);
            } catch (error) {
                vscode.window.showErrorMessage(`${globalThis.globalState.connextProduct}: Failed to parse response from server: ${error}`);
                responseReceived = true;
                return;
            }

            // Check if there's an error in the response
            if (parsedData.error) {
                vscode.window.showErrorMessage(`${globalThis.globalState.connextProduct}: Error processing request in server: ${parsedData.error_description}`);
                responseReceived = true;
                return;
            }

            if (parsedData.last_token && parsedData.last_token === true) {
                responseReceived = true;
            } else {
                response.markdown(parsedData.token);
            }
        });

        const jsonPayload = {
            id: generateRequestId(),
            question: getPrompt(userQuery, context),
        };

        socket.emit('message', JSON.stringify(jsonPayload));

        await waitForCondition(() => responseReceived, 120000, 10);

        if (!responseReceived) {
            vscode.window.showErrorMessage(`${globalThis.globalState.connextProduct}: Request timed out.`);
        }

        socket.off('response');
    });

    chat.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images/bot_avatar.png');
}

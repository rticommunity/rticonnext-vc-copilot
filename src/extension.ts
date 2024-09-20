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

declare global {
    var connextProduct: string;
    var connextUsernameKey: string;
    var connextPasswordKey: string;
    var accessCode: string | undefined;
    var storedUsername: string | undefined;
    var storedPassword: string | undefined;
    var connextIntelligenceUrl: string;
    var connextAuth0Url: string;
}

globalThis.connextProduct = "Connext for Github Copilot";
globalThis.connextUsernameKey = "connextUsername";
globalThis.connextPasswordKey = "connextPassword";
globalThis.connextIntelligenceUrl = "wss://sandbox-chatbot.rti.com";
globalThis.connextAuth0Url = "https://dev-6pfajgsd68a3srda.us.auth0.com";
globalThis.accessCode = undefined;
globalThis.storedUsername = undefined;
globalThis.storedPassword = undefined;

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
        vscode.window.showErrorMessage(`${globalThis.connextProduct}: Error making HTTP request: ${error}`)
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
    // Register the 'connext-vc-copilot.login' command
    let cidpLogin = vscode.commands.registerCommand('connext-vc-copilot.login', async () => {

        // Check if username and password are already stored
        const storedUsername = context.globalState.get<string>(globalThis.connextUsernameKey);
        const storedPassword = context.globalState.get<string>(globalThis.connextPasswordKey);

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
                await context.globalState.update(globalThis.connextUsernameKey, username);
                await context.globalState.update(globalThis.connextPasswordKey, password);
                vscode.window.showInformationMessage(`${globalThis.connextProduct}: Credentials saved for user: ${username}`);
            } else {
                vscode.window.showErrorMessage(`${globalThis.connextProduct}: Both username and password are required.`);
                return false;
            }

            globalThis.storedUsername = username;
            globalThis.storedPassword = password;
        } else {
            globalThis.storedUsername = storedUsername;
            globalThis.storedPassword = storedPassword;
    
            // If credentials already exist, display a confirmation message
            vscode.window.showInformationMessage(`${globalThis.connextProduct}: Welcome back, ${storedUsername}!`);
        }

        return true;
    });

    context.subscriptions.push(cidpLogin);

    // Register the 'github.copilot-chat.logout' command
    let cidpLogout = vscode.commands.registerCommand('connext-vc-copilot.logout', async () => {
        await context.globalState.update(globalThis.connextUsernameKey, undefined);
        globalThis.storedUsername = undefined;
        await context.globalState.update(globalThis.connextPasswordKey, undefined);
        globalThis.storedPassword = undefined;
        globalThis.accessCode = undefined
        vscode.window.showInformationMessage(`${globalThis.connextProduct}: Credentials have been cleared.`);
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

    globalThis.storedUsername = context.globalState.get<string>(globalThis.connextUsernameKey);
    globalThis.storedPassword = context.globalState.get<string>(globalThis.connextPasswordKey);

    // Create a Copilot chat participant
    const chat = vscode.chat.createChatParticipant("connext-vc-copilot.chat", async (request, context, response, token) => {
        const userQuery = request.prompt;

        if (globalThis.storedUsername === undefined || globalThis.storedPassword === undefined) {
            var success = await vscode.commands.executeCommand('connext-vc-copilot.login');

            if (!success) {
                vscode.window.showInformationMessage(`Please log in to ${globalThis.connextProduct} to continue.`);
                return;
            }
        }

        if (globalThis.accessCode === undefined) {
            // Get access token
            const uri = globalThis.connextAuth0Url + '/oauth/token';
            const jsonPayload = {
                grant_type: 'password',
                username: globalThis.storedUsername,
                password: globalThis.storedPassword,
                audience: 'https://chatbot.rti.com/api/v1',
                scope: 'ask:question session:create session:delete session:update',
                client_id: '<replace with your client_id>',
                client_secret: '<replace with your client_secret>'
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
                vscode.window.showErrorMessage(`${globalThis.connextProduct}: Error getting access token: ${jsonResponse.error_description}`);
                return;
            }

            globalThis.accessCode = jsonResponse.access_token;
        }

        // Send request and get response for the user query
        const socket: Socket = io(globalThis.connextIntelligenceUrl, {
            extraHeaders: {
                authorization: `bearer ${globalThis.accessCode}`
            },
            reconnectionAttempts: 3,
        });

        socket.on('connect_error', (err: Error) => {
            if (err.message != "") {
                vscode.window.showErrorMessage(`Error connecting to ${globalThis.connextProduct} Socket.IO server: ${err}`)
            } else {
                vscode.window.showErrorMessage(`Error connecting to ${globalThis.connextProduct} Socket.IO server`)
            }
        });

        let connectionReady = false;
        let responseReceived = false;

        socket.on("connect", () => {
            connectionReady = true;
        });

        socket.on("disconnect", () => {
            connectionReady = false;
        });

        socket.on('response', (data: string) => {
            // Convert the data (received as a JSON string) to an object
            let parsedData;

            try {
                parsedData = JSON.parse(data);
            } catch (error) {
                vscode.window.showErrorMessage(`${globalThis.connextProduct}: Failed to parse response from server: ${error}`);
                responseReceived = true;
                return;
            }
        
            // Check if there's an error in the response
            if (parsedData.error) {
                vscode.window.showErrorMessage(`${globalThis.connextProduct}: Error processing request in server: ${parsedData.error_description}`);
                return;
            }

            if (parsedData.last_token && parsedData.last_token === true) {
                responseReceived = true;
            } else {
                response.markdown(parsedData.token);
            }
        });

        let startTime = Date.now();
        let timeout = 10000; // 10 seconds
        
        while (!connectionReady) {
            if (Date.now() - startTime > timeout) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        if (!connectionReady) {
            vscode.window.showErrorMessage(`${globalThis.connextProduct}: Connection to the server failed.`);
            return;
        }

        const jsonPayload = {
            id: generateRequestId(),
            question: getPrompt(userQuery, context),
        };

        socket.emit('message', JSON.stringify(jsonPayload));

        startTime = Date.now();
        timeout = 120000; // 2 minutes

        while (!responseReceived) {
            if (Date.now() - startTime > timeout) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        if (!responseReceived) {
            vscode.window.showErrorMessage(`${globalThis.connextProduct}: Request timed out.`);
        }
    });

    chat.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images/bot_avatar.png');
}

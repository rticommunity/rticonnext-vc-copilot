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
import { exec } from 'child_process';

class GlobalState {
    readonly connextProduct: string;
    readonly connextUsernameKey: string;
    readonly connextPasswordKey: string;
    readonly connextIntelligenceUrl: string;
    readonly connextAuth0Url: string;
    readonly MAX_HISTORY_LENGTH: number;
    readonly NUM_FOLLOWUPS: number;
    readonly VALIDATE_CODE_PROMPT_PREFIX: string;

    extensionUri: vscode.Uri;
    accessCode: string | undefined;
    storedUsername: string | undefined;
    storedPassword: string | undefined;
    lastPrompt: string | null;
    lastResponse: string | null;

    socket: Socket | undefined;
    connectionReady: boolean;

    constructor() {
        // Set to displayName
        this.connextProduct = "Connext for Github Copilot";
        this.connextUsernameKey = "connextUsername";
        this.connextPasswordKey = "connextPassword";
        this.connextIntelligenceUrl = "wss://sandbox-chatbot.rti.com";
        this.connextAuth0Url = "https://dev-6pfajgsd68a3srda.us.auth0.com";
        this.MAX_HISTORY_LENGTH = 65536;
        this.NUM_FOLLOWUPS = 3;
        this.VALIDATE_CODE_PROMPT_PREFIX = "Validate previous";

        this.accessCode = undefined;
        this.storedUsername = undefined;
        this.storedPassword = undefined;
        this.extensionUri = vscode.Uri.parse(''); // Placeholder value, update when valid value is available

        this.socket = undefined;
        this.connectionReady = false;

        this.lastPrompt = null
        this.lastResponse = null
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

interface IChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    }
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
 * If response is null, the prompt is returned with the chat history.
 * If response is not null, the prompt is returned with the chat history and 
 * the response for the prompt.
 * 
 * @param prompt - The prompt.
 * @param response - The response.
 * @param context - The chat context containing the history of previous messages.
 * @returns The chat history with the prompt and response.
 */
function getPrompt(prompt: string | null, response: string | null, context: vscode.ChatContext): string {
    let previousMessages = context.history;
    const editor = vscode.window.activeTextEditor;

    // Limit the number of previous messages to the maximum history length
    let limit = globalThis.globalState.MAX_HISTORY_LENGTH;

    if (editor) {
        const selection = editor.selection;
        const text = editor.document.getText(selection);
        limit = globalThis.globalState.MAX_HISTORY_LENGTH - text.length;

        if (limit < 0) {
            limit = 0;
        }
    }

    let previousMessagesList = [];

    for (let i = previousMessages.length - 1, userAsk = false, totalLength = 0; i >= 0; i--) {
        if (previousMessages[i] instanceof vscode.ChatRequestTurn) {
            const turn = previousMessages[i] as vscode.ChatRequestTurn;
            previousMessagesList.unshift(`User ask: ${turn.prompt}\n`);
            totalLength += turn.prompt.length;
            userAsk = true;
        } else if (previousMessages[i] instanceof vscode.ChatResponseTurn) {
            const turn = previousMessages[i] as vscode.ChatResponseTurn;
            let response = `Bot response: `;

            for (let i = 0; i < turn.response.length; i++) {
                const responsePart = turn.response[i].value;

                if (responsePart instanceof vscode.MarkdownString) {
                    response += `${responsePart.value}\n`
                }
            }

            previousMessagesList.unshift(response);
            totalLength += response.length;
            userAsk = false;
        }

        if (totalLength > limit && userAsk) {
            // Pop the last user ask
            previousMessagesList.shift();

            if (previousMessagesList.length > 0) {
                // Pop the last bot response
                previousMessagesList.shift();
            }

            break;
        }
    }

    let strContext = "";

    for (let i = 0; i < previousMessagesList.length; i++) {
        strContext += previousMessagesList[i];
    }

    if (prompt === null) {
        return strContext;
    }

    if (editor && response == null) {
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

        if (response !== null) {
            strContext += `Bot response: ${response}\n`
        }
    }

    return strContext;
}

/**
 * Asks a question to a language model and returns the response.
 *
 * @param question - The question to ask the language model.
 * @param token - A cancellation token to cancel the request if needed.
 * @returns A promise that resolves to the response from the language model.
 */
async function askQuestion(question: string, token: vscode.CancellationToken): Promise<string> {
    const MODEL_SELECTOR: vscode.LanguageModelChatSelector = { vendor: 'copilot', family: 'gpt-4o' };

    const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);

    const messages = [
        vscode.LanguageModelChatMessage.User(question)
    ];

    let response = "";

    const chatResponse = await model.sendRequest(messages, {}, token);
    for await (const fragment of chatResponse.text) {
        response += fragment;
    }

    return response;
}

/**
 * Generates potential follow-up questions for an RTI Connext developer based on the context of an ongoing conversation.
 * 
 * @param num_followups - The number of follow-up questions to generate.
 * @param conversation - The full context of the ongoing conversation.
 * @param token - A cancellation token to signal the operation should be canceled.
 * @returns A promise that resolves to an array of follow-up questions, each containing a prompt and a concise summary.
 * 
 * @example
 * ```typescript
 * const followUps = await generateFollowUps(3, "How do I configure QoS settings?", token);
 * console.log(followUps);
 * // Output:
 * // [
 * //   { prompt: "What are the default QoS settings?", label: "Default QoS settings" },
 * //   { prompt: "How can I customize QoS?", label: "Customizing QoS" },
 * //   { prompt: "What is the impact of QoS?", label: "Impact of QoS" }
 * // ]
 * ```
 */
async function generateFollowUps(num_followups: number, conversation: string, token: vscode.CancellationToken): Promise<vscode.ChatFollowup[]> {
    const QUESTION = `
    You are an RTI Connext chatbot tasked with generating potential follow-up 
    questions that the RTI Connext developer might want to ask you during an 
    ongoing conversation.
    
    The developer may be new to RTI Connext or have limited experience with the 
    technology. They are seeking guidance on how to advance their project or 
    resolve specific issues.
    
    Your goal is to generate ${num_followups} concise and relevant follow-up 
    questions that the developer could ask you, based on the full context of 
    the conversation. These questions should help keep the developer engaged 
    and guide them towards useful solutions.
    
    Output the questions in valid JSON format, structured as follows:
    
    {
        "questions": [
            {
            "question": "Developer's potential follow-up question here",
            "summary": "Concise 7-word summary of the question"
            },
            {
            "question": "Developer's potential follow-up question here",
            "summary": "Concise 7-word summary of the question"
            }
        ]
    }
    
    conversation START:
    ${conversation}
    conversation END
    `;

    let response = await askQuestion(QUESTION, token);

    response = response.replace('```json', '');
    response = response.replace('```', '');

    let parsedData;

    try {
        parsedData = JSON.parse(response);
    } catch (error) {
        /* Any error leads to an empty followup */
        return [];
    }

    let followups = [];

    for (let i = 0; i < parsedData.questions.length; i++) {
        followups.push({
            prompt: parsedData.questions[i].question,
            label: parsedData.questions[i].summary,
        });
    }

    return followups;
}

/**
 */
async function generateBotFollowUp(conversation: string, token: vscode.CancellationToken): Promise<string | null> {
    const QUESTION = `
    You are an RTI Connext chatbot tasked with generating a potential follow-up
    question from you to the RTI Connext developer based on the context of an
    ongoing conversation and a developer question/request. The developer may be 
    new to RTI Connext or have limited experience with the technology. They are 
    seeking guidance on how to advance their project or resolve specific issues. 
    Your goal is to generate a concise and relevant follow-up question that you 
    could ask the developer, based on the full context of the conversation. This 
    question should help keep the developer engaged and guide them towards 
    useful solutions. Only generate one follow-up question if you feel
    you need more information to answer the developer's question/request.

    Only generate follow-up questions for this topics:
    - IDL and XML type design.
    - rtiddsgen and code generation for parameters that are unknown and need to 
    be defined by the user.

    For example:

    User question: Can you provide an example IDL?
    Bot question: What information are you looking for in the IDL?

    For example:

    User question: How to compile an IDL file?
    Bot question: What language are you using to compile the IDL file?

    Output the question in valid JSON format, structured as follows:

    If there is a follow-up question:
    {
        "questions": [
            {
            "question": "Developer's potential follow-up question here",
            "summary": "Concise 7-word summary of the question"
            }
        ]
    }

    If there is no follow-up question:
    {
        "questions": []
    }

    conversation START:
    ${conversation}
    conversation END
    `;

    let response = await askQuestion(QUESTION, token);

    response = response.replace('```json', '');
    response = response.replace('```', '');

    let parsedData;

    try {
        parsedData = JSON.parse(response);
    } catch (error) {
        /* Any error leads to an empty followup */
        return null;
    }

    let followup = null;

    if (parsedData.questions.length > 0) {
        followup = parsedData.questions[0].question;
    }

    return followup;
}

/**
 * Analyzes the provided response to determine the types of source code content present.
 * 
 * @param response - The response string to analyze for source code content.
 * @param token - A VS Code cancellation token to handle operation cancellation.
 * @returns A promise that resolves to a set of strings representing the detected programming languages.
 * 
 * The function checks for the presence of specific language code blocks (e.g., Python, XML) within the response.
 * It uses a predefined list of languages and searches for corresponding code block markers (e.g., ```python).
 * If such markers are found, the respective language is added to the result set.
 * 
 * Additionally, the function formulates a question to further analyze the response content using an external
 * question-answering service. The expected output from this service is in JSON format, specifying the detected
 * content types. The function parses this JSON output and adds any valid content types to the result set.
 * 
 * If the JSON parsing fails, the function returns the initially detected languages.
 */
async function getCodeContentInfo(response: string, token: vscode.CancellationToken): Promise<Set<string>> {
    const languages = ["python", "xml"];

    let languagesInResponse = new Set<string>();

    for (let language of languages) {
        if (response.includes('```' + language)) {
            languagesInResponse.add(language);
        }
    }

    const QUESTION = `
    Determine the source code content in the following response:
    <<BEGIN>>
    ${response}
    <<END>>

    The output should be in JSON format as follows:
    {
        "code_content": ["content-type", "content-type"]
    }

    Where each content-type can be any of the following: ${languages.join(", ")}
    `;

    let sourceCode = await askQuestion(QUESTION, token);

    let parsedData;

    try {
        parsedData = JSON.parse(sourceCode);
    } catch (error) {
        return languagesInResponse;
    }

    for (let content of parsedData.code_content) {
        content = content.toLowerCase();

        if (languages.includes(content)) {
            languagesInResponse.add(content);
        }
    }

    return languagesInResponse;
}

/**
 * Determines if a given prompt is related to the application_name.
 *
 * @param application_name - The name of the application to be evaluated.
 * @param prompt - The prompt string to be evaluated.
 * @param token - A VS Code cancellation token to handle cancellation.
 * @returns A promise that resolves to a boolean indicating whether the prompt is related to the application_name.
 */
async function isPromptRelatedToApplication(application_name: string, prompt: string, token: vscode.CancellationToken): Promise<boolean> {
    const QUESTION = `
    Determine if the following prompt refers to the ${application_name} application:
    <<BEGIN>>
    ${prompt}
    <<END>>

    The output should be in JSON format as follows:
    {
        "result": true|false
    }
    `;

    let applicationResponse = await askQuestion(QUESTION, token);

    applicationResponse = applicationResponse.replace('```json', '');
    applicationResponse = applicationResponse.replace('```', '');

    let parsedData;

    try {
        parsedData = JSON.parse(applicationResponse);
        return parsedData.result;
    } catch (error) {
        return false;
    }
}

function runApplication(applicationName: string) {
    // Use child_process.exec to run the external application
    exec(applicationName, (err, stdout, stderr) => {
        if (err) {
            // Handle the error
            vscode.window.showErrorMessage(`Error running command: ${err.message}`);
            return;
        }
    });
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

    // Validate code command
    vscode.commands.registerCommand('connext-vc-copilot.validate-code', (languages: string) => {
        const VALIDATE_CODE_PROMPT = globalState.VALIDATE_CODE_PROMPT_PREFIX + " " + languages + " code and provide the updated code"
        vscode.commands.executeCommand('workbench.action.chat.open', `@connext ${VALIDATE_CODE_PROMPT}`);
    });

    // Run Admin Console
    vscode.commands.registerCommand('connext-vc-copilot.run-admin-console', () => {
        const command = 'rtiadminconsole';

        runApplication(command);
    });
    
    // Run System Designer
    vscode.commands.registerCommand('connext-vc-copilot.run-system-designer', () => {
        const command = 'rtisystemdesigner';

        runApplication(command);
    });

    // Run Monitor
    vscode.commands.registerCommand('connext-vc-copilot.run-monitor-ui', () => {
        const command = 'rtimonitor';

        runApplication(command);
    });

    // Run Shape Demo
    vscode.commands.registerCommand('connext-vc-copilot.run-shapes-demo', () => {
        const command = 'rtishapesdemo';

        runApplication(command);
    });

    globalThis.globalState.storedUsername = context.globalState.get<string>(globalThis.globalState.connextUsernameKey);
    globalThis.globalState.storedPassword = context.globalState.get<string>(globalThis.globalState.connextPasswordKey);

    // Create a Copilot chat participant
    const chat = vscode.chat.createChatParticipant("connext-vc-copilot.chat", async (request, context, response, token) => {
        globalState.lastPrompt = request.prompt;

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

        if (request.command === 'start-admin-console') {
            runApplication('rtiadminconsole');
            response.markdown("Starting RTI Admin Console...");
            return
        } else if (request.command === 'start-system-designer') {
            runApplication('rtisystemdesigner');
            response.markdown("Starting RTI System Designer...");
            return
        } else if (request.command === 'start-monitor-ui') {
            runApplication('rtimonitor');
            response.markdown("Starting RTI Monitor...");
            return
        } else if (request.command === 'start-shapes-demo') {
            runApplication('rtishapesdemo');
            response.markdown("Starting RTI Shapes Demo...");
            return 
        }

        //let botFollowup = await generateBotFollowUp(getPrompt(globalState.lastPrompt, null, context), token);
        
        //if (botFollowup != null) {
        //    response.markdown(botFollowup);
        //    return;
        //}

        let socket;
        globalState.lastResponse = "";

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
                globalState.lastResponse += parsedData.token;
                response.markdown(parsedData.token);
            }
        });

        const jsonPayload = {
            id: generateRequestId(),
            question: getPrompt(globalState.lastPrompt, null, context),
        };

        socket.emit('message', JSON.stringify(jsonPayload));

        await waitForCondition(() => responseReceived, 120000, 10);

        if (!responseReceived) {
            vscode.window.showErrorMessage(`${globalThis.globalState.connextProduct}: Request timed out.`);
        } else {
            let validationPrompt = globalState.lastPrompt.includes(globalState.VALIDATE_CODE_PROMPT_PREFIX);
            let languages = await getCodeContentInfo(globalState.lastResponse, token);

            if (languages.size != 0 && !validationPrompt) {
                let languagesString = Array.from(languages).join(", ");

                response.markdown(`\n\n*Click 'Validate Code' to check the XML or Python for errors. The chatbot will try to fix issues with the XML schema, or Python syntax or types. Validation may take up to a minute.*`);

                response.button({
                    command: 'connext-vc-copilot.validate-code',
                    title: vscode.l10n.t('Validate code'),
                    arguments: [languagesString]
                });
            }

            if (await isPromptRelatedToApplication("RTI Admin Console", globalState.lastPrompt, token)) {
                response.markdown(`\n\n*Click 'Run Admin Console' to open the RTI Admin Console from Visual Code.*`);
                
                response.button({
                    command: 'connext-vc-copilot.run-admin-console',
                    title: vscode.l10n.t('Run Admin Console'),
                    arguments: []
                });
            } else if (await isPromptRelatedToApplication("RTI System Designer", globalState.lastPrompt, token)) {
                response.markdown(`\n\n*Click 'Run System Designer' to open the RTI System Designer from Visual Code.*`);

                response.button({
                    command: 'connext-vc-copilot.run-system-designer',
                    title: vscode.l10n.t('Run System Designer'),
                    arguments: []
                });
            } else if (await isPromptRelatedToApplication("RTI Monitor", globalState.lastPrompt, token)) {
                response.markdown(`\n\n*Click 'Run Monitor' to open the RTI Monitor from Visual Code.*`);

                response.button({
                    command: 'connext-vc-copilot.run-monitor-ui',
                    title: vscode.l10n.t('Run Monitor'),
                    arguments: []
                });
            } else if (await isPromptRelatedToApplication("RTI Shapes Demo", globalState.lastPrompt, token)) {
                response.markdown(`\n\n*Click 'Run Shapes Demo' to open the RTI Shapes Demo from Visual Code.*`);

                response.button({
                    command: 'connext-vc-copilot.run-shapes-demo',
                    title: vscode.l10n.t('Run Shapes Demo'),
                    arguments: []
                });
            }

            if (validationPrompt) {
                response.markdown(`\n\n***NOTE:** Although the code has been validated, it may still contain errors. Please review and test the code before using it.*`);
            }
        }

        socket.off('response');
    });

    chat.followupProvider = {
        async provideFollowups(
            result: IChatResult, context: vscode.ChatContext, token: vscode.CancellationToken) {
            if (result.metadata.command != 'start-admin-console') {
                return await generateFollowUps(globalState.NUM_FOLLOWUPS, getPrompt(globalState.lastPrompt, globalState.lastResponse, context), token);
            }
        }
    };

    chat.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images/bot_avatar.png');
}

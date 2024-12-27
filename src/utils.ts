/*******************************************************************************
 * (c) Copyright, Real-Time Innovations, 2024.
 * All rights reserved.
 * No duplications, whole or partial, manual or electronic, may be made
 * without express written permission.  Any such copies, or
 * revisions thereof, must display this notice unaltered.
 * This code contains trade secrets of Real-Time Innovations, Inc.
 */

import * as vscode from "vscode";
import fetch from "node-fetch";
import { exec, execSync } from "child_process";

export const CONNEXT_PRODUCT = "Connext for Github Copilot";

/**
 * Displays an error message in the Visual Studio Code interface.
 *
 * @param message - The error message to be displayed.
 */
export function showErrorMessage(message: string) {
    vscode.window.showErrorMessage(
        `${CONNEXT_PRODUCT}: ${message}`
    );
}

/**
 * Displays an information message in the Visual Studio Code editor.
 *
 * @param message - The message to be displayed.
 */
export function showInformationMessage(message: string) {
    vscode.window.showInformationMessage(
        `${CONNEXT_PRODUCT}: ${message}`
    );
}

/**
 * Asks a question to a language model and returns the response.
 *
 * @param question - The question to ask the language model.
 * @param token - A cancellation token to cancel the request if needed.
 * @returns A promise that resolves to the response from the language model.
 */
export async function askQuestion(
    question: string,
    token: vscode.CancellationToken
): Promise<string> {
    const MODEL_SELECTOR: vscode.LanguageModelChatSelector = {
        vendor: "copilot",
        family: "gpt-4o",
    };

    const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);

    const messages = [vscode.LanguageModelChatMessage.User(question)];

    let response = "";

    const chatResponse = await model.sendRequest(messages, {}, token);
    for await (const fragment of chatResponse.text) {
        response += fragment;
    }

    return response;
}

/**
 * Asks a question to a language model and returns the response as a JSON object.
 *
 * @param question - The question to ask the language model.
 * @param token - A cancellation token to cancel the request if needed.
 * @returns A promise that resolves to the response from the language model as a JSON object.
 */
export async function askQuestionWithJsonResponse(
    question: string,
    token: vscode.CancellationToken
): Promise<any | undefined> {
    let response = await askQuestion(question, token);
    let jsonObject = undefined;

    try {
        response = response.replace("```json", "");
        response = response.replace("```", "");
        jsonObject = JSON.parse(response);
    } catch (e: any) {
        showErrorMessage(
            `Error parsing JSON response: ${e.message}`
        );
        return undefined;
    }

    return jsonObject;
}

/**
 * Makes an HTTP request to the specified URI with the given options.
 *
 * @param uri - The URI to which the HTTP request is made.
 * @param options - The options to configure the HTTP request.
 * @returns A promise that resolves to the response data if the request is successful, or `undefined` if the request fails.
 */
export async function makeHttpRequest(
    uri: string,
    options: fetch.RequestInit
): Promise<any | undefined> {
    try {
        const response = await fetch(uri, options);

        if (!response.ok) {
            showErrorMessage(`HTTP request failed with status ${response.status}`);
            return undefined;
        }

        const data = await response.json(); // Parse the JSON response
        return data;
    } catch (error) {
        showErrorMessage(`Error making HTTP request: ${error}`);
        return undefined;
    }
}

/**
 * Asks a question to the Connext Intelligence Platform.
 *
 * @param question - The question to ask.
 * @param accessCode - The access code to authenticate with the Intelligence Platform.
 * @param token - A VS Code cancellation token.
 * @returns A promise that resolves to the response from the Intelligence Platform, or undefined if an error occurs or the URL is not set.
 */
export async function askQuestionToConnext(
    question: string,
    accessCode: string,
    token: vscode.CancellationToken
): Promise<string | undefined> {
    let config = vscode.workspace.getConfiguration("connext");

    let intelligencePlatformUrl: string | undefined = config.get(
        "intelligencePlatformUrl"
    );

    if (intelligencePlatformUrl == undefined) {
        showErrorMessage(
            "The Intelligence Platform URL is not set. Please set it in the settings."
        );
        return undefined;
    }

    let intelligencePlatformHttpUrl = intelligencePlatformUrl.replace(
        "wss://",
        "https://"
    );

    let uri = `${intelligencePlatformHttpUrl}/api/v1/ask`;

    let options: fetch.RequestInit = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessCode}`,
        },
        body: JSON.stringify({
            question: question,
        }),
    };

    try {
        const jsonResponse = await makeHttpRequest(uri, options);
        return jsonResponse.response;
    } catch (error) {
        showErrorMessage(`Error asking question to Connext: ${error}`);
        return undefined;
    }
}

/**
 * Asks a question to the Connext export and returns the response as a JSON object.
 *
 * @param question - The question to ask the Connext expert.
 * @param accessCode - The access code to authenticate with the Intelligence Platform.
 * @param token - A cancellation token to cancel the request if needed.
 * @returns A promise that resolves to the response from the Connext expert as a JSON object.
 */
export async function askQuestionToConnextWithJsonResponse(
    question: string,
    accessCode: string,
    token: vscode.CancellationToken
): Promise<any | undefined> {
    let response = await askQuestionToConnext(question, accessCode, token);

    if (response == undefined) {
        return undefined;
    }

    let jsonObject = undefined;

    try {
        response = response.replace("```json", "");
        response = response.replace("```", "");
        jsonObject = JSON.parse(response);
    } catch (e: any) {
        showErrorMessage(
            `Error parsing JSON response: ${e.message}`
        );
        return undefined;
    }

    return jsonObject;
}

/**
 * Checks if the current operating system is Windows.
 *
 * @returns {boolean} `true` if the platform is Windows, otherwise `false`.
 */
export function isWindows() {
    return process.platform === "win32";
}

/**
 * Checks if the current operating system is Mac.
 *
 * @returns {boolean} `true` if the platform is Mac, otherwise `false`.
 */
export function isMac() {
    return process.platform === "darwin";
}

/**
 * Checks if the current operating system is Linux.
 *
 * @returns {boolean} `true` if the platform is Linux, otherwise `false`.
 */
export function isLinux() {
    return process.platform === "linux";
}

/**
 * Returns the default shell for the current operating system.
 * 
 * On Windows, it returns the value of the `ComSpec` environment variable if set,
 * otherwise it defaults to "cmd.exe".
 * 
 * On Unix-like systems, it returns the value of the `SHELL` environment variable if set,
 * otherwise it defaults to "/bin/bash".
 * 
 * @returns {string} The default shell for the current operating system.
 */
export function getDefaultShell() {
    return isWindows()
        ? process.env.ComSpec || "cmd.exe"
        : process.env.SHELL || "/bin/bash";
}

/**
 * Executes a shell command asynchronously.
 *
 * @param command - The command to execute.
 * @throws Will throw an error if the command execution fails.
 */
export function runCommand(
    command: string,
) {
    const shell = getDefaultShell();

    // Use child_process.exec to run the external application
    exec(command, { shell }, (err, stdout, stderr) => {
        if (err) {
            // Handle the error
            throw new Error(
                `Error running command: ${err.message}`
            );
        }
    });
}

/**
 * Executes a shell command synchronously.
 *
 * @param command - The command to execute.
 * @throws Will throw an error if the command execution fails.
 */
export function runCommandSync(command: string) {
    try {
        const shell = getDefaultShell();
        const output = execSync(command, { shell });
    } catch (err : any) {
        throw new Error(`Error running command: ${err.message}`);
    }
}



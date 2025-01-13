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
import * as fs from 'fs/promises';

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

    intelligencePlatformHttpUrl = intelligencePlatformHttpUrl.replace(
        "ws://",
        "http://"
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

/**
 * Recursively reads the contents of a directory and returns a list of file paths and their types.
 *
 * @param dir - The URI of the directory to read.
 * @param relativePath - The relative path from the initial directory (default is an empty string).
 * @returns A promise that resolves to an array of tuples, each containing a file path and its type.
 */
export async function readDirectoryRecursive(dir: vscode.Uri, relativePath: string = ''): Promise<[string, vscode.FileType][]> {
    let results: [string, vscode.FileType][] = [];
    const entries = await vscode.workspace.fs.readDirectory(dir);

    for (const [name, type] of entries) {
        const fullPath = relativePath ? `${relativePath}/${name}` : name;
        
        if (type === vscode.FileType.Directory) {
            const subDirUri = vscode.Uri.joinPath(dir, name);
            const subDirFiles = await readDirectoryRecursive(subDirUri, fullPath);
            results = results.concat(subDirFiles);
        }
        
        results.push([fullPath, type]);
    }

    return results;
}

/**
 * Returns a string representing the current platform.
 *
 * @returns {string} - The platform string, which can be "windows", "mac", "linux", or "unknown".
 */
export function getPlatformStr() {
    if (isWindows()) {
        return "windows";
    } else if (isMac()) {
        return "mac";
    } else if (isLinux()) {
        return "linux";
    } else {
        return "unknown";
    }
}

/**
 * Retrieves the list of available .NET SDK versions installed on the system.
 *
 * @returns {Promise<string[]>} A promise that resolves to an array of .NET SDK version strings.
 *
 * @throws Will throw an error if the command execution fails or if there is any error output.
 *
 * @example
 * ```typescript
 * getAvailableDotnetSDKVersions()
 *     .then(versions => {
 *         console.log('Available .NET SDK versions:', versions);
 *     })
 *     .catch(error => {
 *         console.error('Error:', error);
 *     });
 * ```
 */
async function getAvailableDotnetSDKVersions(): Promise<string[]> {
    return new Promise((resolve, reject) => {
        exec('dotnet --list-sdks', (error, stdout, stderr) => {
            if (error) {
                reject(`Error executing command: ${error.message}`);
                return;
            }

            if (stderr) {
                reject(`Error output: ${stderr}`);
                return;
            }

            // Parse the output
            const sdks = stdout
                .split('\n') // Split by line
                .map(line => line.trim()) // Remove leading/trailing spaces
                .filter(line => line) // Remove empty lines
                .map(line => {
                    const match = line.match(/^([\d\.]+) \[(.*)\]$/);
                    return match ? match[1] : null; // Extract version
                })
                .filter((version): version is string => version !== null); // Filter out nulls

            resolve(sdks);
        });
    });
}

/**
 * Maps a given version string to a corresponding .NET framework name.
 *
 * @param version - The version string to map (e.g., "7.0.100").
 * @returns The corresponding framework name (e.g., "net7") or undefined if the version is invalid or not recognized.
 */
function mapVersionToFramework(version: string): string | undefined {
    const majorVersion = version.split(".")[0]; // Extract the major version (e.g., "7" from "7.0.100")
    if (!majorVersion) {
        return undefined; // Return undefined if the version string is invalid
    }

    const versionMap: { [key: string]: string } = {
        "8": "net8",
        "7": "net7",
        "6": "net6",
        "5": "net5"
    };

    return versionMap[majorVersion];
}

/**
 * Retrieves the available .NET frameworks by fetching the SDK versions
 * and mapping them to their corresponding framework names.
 *
 * @returns {Promise<string[]>} A promise that resolves to an array of .NET framework names.
 * If an error occurs, the promise resolves to an empty array.
 */
async function getDotnetFrameworks(): Promise<string[]> {
    try {
        const sdks = await getAvailableDotnetSDKVersions();
        const frameworks = sdks.map(mapVersionToFramework);
        const filteredFrameworks = frameworks.filter(
            (framework): framework is string => framework !== undefined
        );
        return filteredFrameworks;
    } catch (error) {
        return [];
    }
}

/**
 * Retrieves the highest .NET framework version available from the system.
 *
 * @returns {Promise<string | undefined>} A promise that resolves to the highest .NET framework version
 * available (e.g., "net8", "net7", "net6", "net5"), or `undefined` if none of the specified versions are found.
 */
export async function getHighestDotnetFramework(): Promise<string | undefined> {
    const frameworks = await getDotnetFrameworks();
    const versions = ["net8", "net7", "net6", "net5"];

    for (const version of versions) {
        if (frameworks.includes(version)) {
            return version;
        }
    }

    return undefined;
}

interface LanguageInfo {
    name: string;
    srcExtension: string;
    headerExtension: string;
    markupCode: string;
}

/**
 * Retrieves information about a given programming language.
 *
 * @param language - The name of the programming language.
 * @returns An object containing the language name, src file extension, header file extension. and a markup code string, or `undefined` if the language is not recognized.
 */
export function getLanguageInfo(language: string): LanguageInfo | undefined {
    const extensionMap: {
        [key: string]: {
            srcExtension: string;
            headerExtension: string;
            markupCode: string;
        };
    } = {
        Java: {
            srcExtension: "java",
            headerExtension: "java",
            markupCode: "java",
        },
        "C#": { srcExtension: "cs", headerExtension: "cs", markupCode: "cs" },
        C: { srcExtension: "c", headerExtension: "h", markupCode: "c" },
        "C++98": {
            srcExtension: "cxx",
            headerExtension: "h",
            markupCode: "cpp",
        },
        "C++11": {
            srcExtension: "cxx",
            headerExtension: "hpp",
            markupCode: "cpp",
        },
        Python: {
            srcExtension: "py",
            headerExtension: "py",
            markupCode: "python",
        },
    };

    if (language in extensionMap) {
        return {
            name: language,
            srcExtension: extensionMap[language].srcExtension,
            headerExtension: extensionMap[language].headerExtension,
            markupCode: extensionMap[language].markupCode,
        };
    }

    return undefined;
}

/**
 * Asynchronously reads the content of a text file.
 *
 * @param filePath - The path to the file to be read.
 * @returns A promise that resolves to the content of the file as a string.
 * @throws Will throw an error if the file cannot be read.
 */
export async function readTextFile(filePath: string): Promise<string> {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        return content;
    } catch (error: any) {
        console.error(`Error reading file: ${error.message}`);
        throw error;
    }
}

/**
 * Writes the provided content to a text file at the specified file path.
 *
 * @param filePath - The path to the file where the content should be written.
 * @param content - The text content to write to the file.
 * @returns A promise that resolves when the file has been successfully written.
 * @throws Will throw an error if there is an issue writing the file.
 */
export async function writeTextFile(
    filePath: string,
    content: string
): Promise<void> {
    try {
        await fs.writeFile(filePath, content, "utf-8");
    } catch (error: any) {
        console.error(`Error writing file: ${error.message}`);
        throw error;
    }
}





/*******************************************************************************
 * (c) Copyright, Real-Time Innovations, 2024.
 * All rights reserved.
 * No duplications, whole or partial, manual or electronic, may be made
 * without express written permission.  Any such copies, or
 * revisions thereof, must display this notice unaltered.
 * This code contains trade secrets of Real-Time Innovations, Inc.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import { Installation, Architecture, getDefaultInstallation } from "./installation";

let FILE_NAME_USAGE_PROMPT = `
    When constructing responses that involve using file names, use specific URIs 
    from the conversation if available instead of generic placeholders.

    Example Clarification:
    - If a command is needed for a file located at /tmp/Temperature.xml:
    \t- Not Preferred: rtiddsgen -language C++ -example <your_file.xml>
    \t- Preferred: rtiddsgen -language C++ -example /tmp/Temperature.xml
    `;

let INSTALLATION_NOTE_PREFIX = `Begin Default Installation Info [`;
let INSTALLATION_NOTE_SUFFIX = `] Begin Default Installation Info\n`;

export enum PromptReferenceKind {
    File,
    Selection,
    Unknown,
}

/**
 * Represents a reference to a document within a prompt, including its URI and content.
 */
export class PromptReference {
    kind: PromptReferenceKind;

    /**
     * The URI of the reference.
     * @type {vscode.Uri | undefined}
     */
    uri: vscode.Uri | undefined;

    /**
     * The content of the reference.
     * @type {string | undefined}
     */
    content: string | undefined;

    /**
     * Creates an instance of PromptReference.
     */
    constructor() {
        this.uri = undefined;
        this.content = undefined;
        this.kind = PromptReferenceKind.Unknown;
    }
}

/**
 * Represents a reference to a file.
 * @extends PromptReference
 */
export class FilePromptReference extends PromptReference {
    /**
     * Creates an instance of `FilePromptReference`.
     * @param location - The location of the file.
     */
    constructor(location: vscode.Uri) {
        super();
        this.kind = PromptReferenceKind.File;
        this.uri = location;
        this.content = this.readFileContent();
    }

    /**
     * Reads the content of the file specified by the URI.
     * @returns The content of the file as a string, or `undefined` if an error occurs or the URI is not defined.
     */
    private readFileContent(): string | undefined {
        if (this.uri === undefined) {
            return undefined;
        }

        const filePath = this.uri.fsPath;
        return fs.readFileSync(filePath, "utf-8");
    }
}

/**
 * Represents a reference that captures the currently selected text in the active text editor.
 * @extends PromptReference
 */
export class SelectionPromptReference extends PromptReference {
    /**
     * Creates an instance of `SelectionPromptReference`.
     */
    constructor(location: vscode.Location | undefined = undefined) {
        super();
        this.kind = PromptReferenceKind.Selection;
        const editor = vscode.window.activeTextEditor;

        if (editor === undefined) {
            return;
        }

        const selection = editor.selection;
        this.uri = editor.document.uri;
        this.content = editor.document.getText(selection);

        if (this.content === "") {
            if (location !== undefined) {
                this.content = editor.document.getText(location.range);
            }
        }
    }
}

function chatPromptReferenceToPromptReference(
    references: readonly vscode.ChatPromptReference[]
): PromptReference[] {
    let promptReferences: PromptReference[] = [];

    try {
        for (let ref of references) {
            if (ref.value == undefined) {
                continue;
            }
            if (
                ref.value instanceof vscode.Uri &&
                ref.value.scheme === "file"
            ) {
                let promptRef: FilePromptReference = new FilePromptReference(
                    ref.value
                );

                if (
                    promptRef.uri != undefined &&
                    promptRef.content != undefined
                ) {
                    promptReferences.push(promptRef);
                }
            } else if (ref.value instanceof vscode.Location) {
                let promptRef: SelectionPromptReference =
                    new SelectionPromptReference(ref.value);

                if (
                    promptRef.uri != undefined &&
                    promptRef.content != undefined
                ) {
                    promptReferences.push(promptRef);
                }
            }
        }

        return promptReferences;
    } catch (error) {
        return [];
    }
}

/**
 * Generates a prompt string with references appended in a structured JSON format.
 *
 * @param prompt - The original prompt string.
 * @param references - An array of `vscode.ChatPromptReference` objects or undefined.
 * @returns The prompt string with references appended in JSON format, or the original prompt if no references are provided.
 */
function generatePromptWithReferences(
    prompt: string,
    references: readonly vscode.ChatPromptReference[] | undefined
): string {
    // Return the original prompt if no references are provided
    if (references == undefined || references.length === 0) {
        return prompt + "\n";
    }

    let promptReferences = chatPromptReferenceToPromptReference(references);

    if (promptReferences.length === 0) {
        return prompt + "\n";
    }

    let promptWithReferences = prompt + "\n";

    // Create a structured template for the content references
    promptWithReferences += `Consider the content references provided in the JSON format below to respond to the previous request:\n\n`;

    promptWithReferences += JSON.stringify(
        promptReferences.map((ref) => ({
            kind: PromptReferenceKind[ref.kind],
            uri: ref.uri?.fsPath,
            content: ref.content,
        })),
        null,
        2
    );

    promptWithReferences += "\n";
    return promptWithReferences;
}

/**
 * Retrieves the file paths of all visible text editors that belong to the current workspace.
 *
 * @returns {string[]} An array of file paths for the visible text editors that are part of the workspace.
 */
function getVisibleWorkspaceFiles(): string[] {
    const visibleEditors = vscode.window.visibleTextEditors;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let workspaceFiles: string[] = [];

    if (workspaceFolders && visibleEditors.length > 0) {
        // Get the list of workspace folders (as paths)
        const workspacePaths = workspaceFolders.map(
            (folder) => folder.uri.fsPath
        );

        // Loop through all visible editors
        visibleEditors.forEach((editor) => {
            const filePath = editor.document.uri.fsPath;

            // Check if the file belongs to any workspace folder
            const isInWorkspace = workspacePaths.some((workspacePath) =>
                filePath.startsWith(workspacePath)
            );

            // If the file is in the workspace, add it to the list
            if (isInWorkspace) {
                workspaceFiles.push(filePath);
            }
        });
    }

    return workspaceFiles;
}

/**
 * Retrieves the prompt for the user including chat history.
 *
 * If response is null, the prompt is returned with the chat history.
 * If response is not null, the prompt is returned with the chat history and
 * the response for the prompt.
 *
 * @param prompt - The prompt.
 * @param references - The references.
 * @param response - The response.
 * @param context - The chat context containing the history of previous messages.
 * @returns The chat history with the prompt and response.
 */
export function getPrompt(
    prompt: string | null,
    installations: Installation[] | undefined,
    references: readonly vscode.ChatPromptReference[] | undefined,
    response: string | null,
    context: vscode.ChatContext,
    rest_api: boolean = true
): string {
    let previousMessages = context.history;
    const editor = vscode.window.activeTextEditor;

    const BeginHumanRestMessage = "[[BEGIN Human message]]\n";
    const EndHumanRestMessage = "[[END Human message]]\n";
    const BeginAiRestMessage = "[[BEGIN AI message]]\n";
    const EndAiRestMessage = "[[END AI message]]\n";
    const HumanMessage = "Human message:";
    const AiMessage = "AI message:";

    let limit = globalThis.globalState.MAX_HISTORY_LENGTH;

    let installationInfoStr = null;

    if (installations != undefined) {
        let defaultInstallation: [Installation, Architecture] | undefined =
            getDefaultInstallation(installations);

        if (defaultInstallation != undefined) {

            installationInfoStr =
                INSTALLATION_NOTE_PREFIX +
                `\nFor requests that need information about 
                the Connext Pro installation, such as the architecture for 
                which to build or generate code, the default installation is 
                located at 
                '${defaultInstallation[0].directory}' with 
                architecture '${defaultInstallation[1].name}'.\n` +
                INSTALLATION_NOTE_SUFFIX;

            limit = globalThis.globalState.MAX_HISTORY_LENGTH - installationInfoStr.length;

            if (limit < 0) {
                limit = 0;
            }
        }
    }

    let promptWithReferences = null;

    if (prompt != null) {
        promptWithReferences = generatePromptWithReferences(prompt, references);
        limit = globalThis.globalState.MAX_HISTORY_LENGTH - promptWithReferences.length;

        if (limit < 0) {
            limit = 0;
        }
    }

    let previousMessagesList = [];

    if (limit > 0) {
        for (
            let i = previousMessages.length - 1, userAsk = false, totalLength = 0;
            i >= 0;
            i--
        ) {
            if (previousMessages[i] instanceof vscode.ChatRequestTurn) {
                const turn = previousMessages[i] as vscode.ChatRequestTurn;

                let request = "";
                if (rest_api) {
                    request += BeginHumanRestMessage;
                    request += `${turn.prompt}\n`;
                    request += EndHumanRestMessage;
                } else {
                    request += `${HumanMessage} ${turn.prompt}\n`;
                }

                previousMessagesList.unshift(request);
                totalLength += turn.prompt.length;
                userAsk = true;
            } else if (previousMessages[i] instanceof vscode.ChatResponseTurn) {
                const turn = previousMessages[i] as vscode.ChatResponseTurn;
                let response = "";

                if (rest_api) {
                    response += BeginAiRestMessage;
                } else {
                    response += `${AiMessage} `;
                }

                for (let i = 0; i < turn.response.length; i++) {
                    const responsePart = turn.response[i].value;

                    if (responsePart instanceof vscode.MarkdownString) {
                        response += `${responsePart.value}\n`;
                    }
                }

                if (rest_api) {
                    response += EndAiRestMessage;
                }

                if (
                    response.includes(
                        globalThis.globalState.VALIDATE_CODE_HELP_STRING
                    )
                ) {
                    response = response.replace(
                        globalThis.globalState.VALIDATE_CODE_HELP_STRING,
                        ""
                    );
                }

                if (
                    response.includes(globalThis.globalState.VALIDATE_CODE_WARNING)
                ) {
                    response = response.replace(
                        globalThis.globalState.VALIDATE_CODE_WARNING,
                        ""
                    );
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
    }

    let promptWithContext = "";

    for (let i = 0; i < previousMessagesList.length; i++) {
        promptWithContext += previousMessagesList[i];
    }

    promptWithContext = promptWithContext.replace(FILE_NAME_USAGE_PROMPT, "");
    promptWithContext = promptWithContext.replace(
        new RegExp(`${INSTALLATION_NOTE_PREFIX}.*?${INSTALLATION_NOTE_SUFFIX}`),
        ""
    );

    if (prompt === null) {
        return promptWithContext;
    }

    if (rest_api) {
        promptWithContext += BeginHumanRestMessage;
    } else {
        promptWithContext += `${HumanMessage} `;
    }

    if (installationInfoStr != null) {
        promptWithContext += installationInfoStr;
    }

    promptWithContext += FILE_NAME_USAGE_PROMPT
    promptWithContext += promptWithReferences

    if (rest_api) {
        promptWithContext += EndHumanRestMessage;
    }

    if (response !== null) {
        if (rest_api) {
            promptWithContext += BeginAiRestMessage;
        } else {
            promptWithContext += `${AiMessage} `;
        }

        promptWithContext += `${response}\n`;

        if (rest_api) {
            promptWithContext += EndAiRestMessage;
        }
    }


    return promptWithContext;
}

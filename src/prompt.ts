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

let START_WORKSPACE_INFO = `[Start Workspace Info]\n`;
let END_WORKSPACE_INFO = `[End Workspace Info]\n`;

export enum PromptReferenceKind {
    File,
    Selection,
    Unknown,
}

export enum PromptReferenceAttributes {
    OpenFile,
    UploadedFile,
    SelectedText,
}

/**
 * Represents a reference to a document within a prompt, including its URI and content.
 */
export class PromptReference {
    kind: PromptReferenceKind;

    attributes: PromptReferenceAttributes[];

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
        this.attributes = [];
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
    constructor(location: vscode.Location) {
        super();
        this.kind = PromptReferenceKind.Selection;
        const editor = vscode.window.activeTextEditor;

        if (editor === undefined) {
            return;
        }

        const selection = editor.selection;
        this.uri = editor.document.uri;
        this.content = editor.document.getText(selection);
        this.attributes.push(PromptReferenceAttributes.SelectedText);

        if (this.content === "") {
            if (location !== undefined) {
                this.content = editor.document.getText(location.range);
            }
        }
    }
}

function chatPromptReferenceToPromptReference(
    references: readonly vscode.ChatPromptReference[] | undefined,
    includeAllOpenFiles: boolean = false
): PromptReference[] {
    let promptReferences: PromptReference[] = [];

    try {
        if (references !== undefined) {
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
                        promptRef.attributes.push(PromptReferenceAttributes.UploadedFile);
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
        }

        if (includeAllOpenFiles) {
            const openFiles = getOpenFiles();
            for (let file of openFiles) {
                let promptRef: FilePromptReference | undefined = undefined;

                try {
                    promptRef =new FilePromptReference(
                        vscode.Uri.file(file)
                    );
                } catch (error) {
                    continue;
                }

                if (promptRef != undefined &&
                    promptRef.uri != undefined &&
                    promptRef.content != undefined
                ) {
                    promptRef.attributes.push(PromptReferenceAttributes.OpenFile);
                    promptReferences.push(promptRef);
                }
            }
        }

        return promptReferences;
    } catch (error) {
        return [];
    }
}

function generatePromptWithWorkspaceInfo(
    prompt: string,
    installations: Installation[] | undefined,
    references: readonly vscode.ChatPromptReference[] | undefined,
    includeAllOpenFiles: boolean = false
): string {

    let defaultInstallation: [Installation, Architecture] | undefined =
        undefined;

    if (installations != undefined) {
        defaultInstallation = getDefaultInstallation(installations);
    }

    let promptReferences: PromptReference[] = [];

    if ((references != undefined && references.length > 0) || includeAllOpenFiles) {
        promptReferences = chatPromptReferenceToPromptReference(references, includeAllOpenFiles);
    }

    // Return the original prompt if no references or default installations are provided
    if (promptReferences.length === 0 && defaultInstallation == undefined) {
        return prompt + "\n";
    }

    let promptWithInfo = prompt + "\n";

    // Create a structured template for the content references
    promptWithInfo += START_WORKSPACE_INFO;
    promptWithInfo += `Use the following workspace information to respond to the previous request more specifically.\n`

    if (promptReferences.length > 0) {
        promptWithInfo += `Consider the content references provided in the JSON format below to respond to the previous request:\n\n`;

        promptWithInfo += JSON.stringify(
            promptReferences.map((ref) => ({
                kind: PromptReferenceKind[ref.kind],
                attributes: ref.attributes.map((attr) => PromptReferenceAttributes[attr]),
                uri: ref.uri?.fsPath,
                content: ref.content,
            })),
            null,
            2
        );

        promptWithInfo += "\n";
    }

    // Create a structured template for the default installation information
    if (defaultInstallation != undefined) {
        promptWithInfo += `Consider the default installation info provided in the JSON format below to respond to the previous request:\n\n`;

        promptWithInfo += JSON.stringify(
            {
                directory: defaultInstallation[0].directory,
                architecture: defaultInstallation[1].name,
            },
            null,
            2
        );

        promptWithInfo += "\n";
    }
    promptWithInfo += END_WORKSPACE_INFO;

    return promptWithInfo;
}


function getOpenFiles(): string[] {
    const openEditors = vscode.workspace.textDocuments;
    let openFiles: string[] = [];

    if (openEditors.length > 0) {
        // Loop through all open files
        openEditors.forEach((openFile) => {
            const filePath = openFile.uri.fsPath;
            openFiles.push(filePath);
        });
    }

    return openFiles;
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
 * @param rest_api - Whether to include the REST API tags in the prompt.
 * @param includeAllOpenFiles - Whether to include all open files in the prompt.
 * @returns The chat history with the prompt and response.
 */
export function getPrompt(
    prompt: string | null,
    installations: Installation[] | undefined,
    references: readonly vscode.ChatPromptReference[] | undefined,
    response: string | null,
    context: vscode.ChatContext,
    rest_api: boolean = true,
    includeAllOpenFiles: boolean = false
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
    let promptWithInfo = null;

    if (prompt != null) {
        promptWithInfo = generatePromptWithWorkspaceInfo(prompt, installations, references, includeAllOpenFiles);
        limit = globalThis.globalState.MAX_HISTORY_LENGTH - promptWithInfo.length;

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

                if (response.trim() === BeginAiRestMessage.trim()) {
                    response += "No response provided.\n";
                }

                if (rest_api) {
                    response += EndAiRestMessage;
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

    promptWithContext = promptWithContext.replace(
        new RegExp(`${START_WORKSPACE_INFO}.*?${END_WORKSPACE_INFO}`),
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

    promptWithContext += promptWithInfo

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

    // Save prompt string into a file
    if (response === null) {
         fs.writeFileSync("/Users/fernando/RTI/AI/demos/demo_plc/prompt.txt", promptWithContext);
    }

    return promptWithContext;
}

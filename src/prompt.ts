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
import {readBinaryFileAdBase64Sync, isSupportedImageFile, isBinaryFile} from "./utils";

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
     * Indicate if the reference is a system representation reference
     * (image or draw.io file). It is set to unknown by default.
     * 
     * Unknown: The reference is not a system representation reference.
     */
    sytemRepresentationKind: SystemRepresentation;

    /**
     * Creates an instance of `FilePromptReference`.
     * @param location - The location of the file.
     */
    constructor(location: vscode.Uri) {
        super();
        this.kind = PromptReferenceKind.File;
        this.uri = location;
        this.sytemRepresentationKind = SystemRepresentation.Unknown;

        if (isBinaryFile(location.fsPath)) {
            this.content = readBinaryFileAdBase64Sync(location.fsPath);
            this.sytemRepresentationKind = SystemRepresentation.Image;
        } else {
            let extension = location.fsPath.split(".").pop();
            if (extension === "drawio") {
                this.sytemRepresentationKind = SystemRepresentation.DrawIO;
            }
            this.content = this.readFileContent();
        }
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

/**
 * Converts an array of `vscode.ChatPromptReference` objects to an array of `PromptReference` objects.
 *
 * @param references - An array of `vscode.ChatPromptReference` objects or `undefined`.
 * @param onlyTextFiles - A boolean indicating whether to include only text files. Defaults to `false`.
 * @param includeAllOpenFiles - A boolean indicating whether to include all open files. Defaults to `false`.
 * @returns An array of `PromptReference` objects.
 */
function chatPromptReferenceToPromptReference(
    references: readonly vscode.ChatPromptReference[] | undefined,
    onlyTextFiles: boolean = false,
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
                    if (isBinaryFile(ref.value.fsPath)) {
                        if (!isSupportedImageFile(ref.value.fsPath) || onlyTextFiles) {
                            /* We only support images for now as binary files */
                            continue;
                        }
                    }

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
            let openFiles = undefined;
            if (onlyTextFiles) {
                openFiles = getOpenTextFiles();
            } else {
                openFiles = getAllOpenFiles();
            }

            for (let file of openFiles) {
                let promptRef: FilePromptReference | undefined = undefined;

                if (isBinaryFile(file)) {
                    if (!isSupportedImageFile(file)) {
                        /* We only support images for now as binary files */
                        continue;
                    }
                }

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
        promptReferences = chatPromptReferenceToPromptReference(references, true, includeAllOpenFiles);
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

    promptWithInfo += `If there are images in the request content, use them to respond as well.\n`;
    promptWithInfo += END_WORKSPACE_INFO;

    return promptWithInfo;
}


/**
 * Retrieves the file paths of all currently open text files in the editor.
 *
 * @returns {string[]} An array of file paths of the open text files.
 */
function getOpenTextFiles(): string[] {
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
 * Retrieves a list of file paths for all currently open files in the editor.
 *
 * This function iterates through all tab groups and their respective tabs,
 * collecting the file paths of open text files and custom binary files (e.g., images)
 * that are opened by extensions.
 *
 * @returns {string[]} An array of file paths for all open files.
 */
function getAllOpenFiles(): string[] {
    let openFiles: string[] = [];
    
    vscode.window.tabGroups.all.forEach(group => {
        group.tabs.forEach(tab => {
            if (tab.input instanceof vscode.TabInputText) {
                openFiles.push(tab.input.uri.fsPath);
            } else if (tab.input instanceof vscode.TabInputCustom) {
                // Handles custom binary files opened by extensions (e.g., images)
                openFiles.push(tab.input.uri.fsPath);
            }
        });
    });

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

                let promptValue: string | null = turn.prompt;

                if (
                    turn.command != undefined &&
                    turn.command == "generateSystemXmlModel"
                ) {
                    // The prompt does not have a value and we have to generate
                    // a prompt for the history based on what it was used
                    // in the command. We ignore the references in this case.
                    // because we may not have the references available 
                    // anymore
                    promptValue = getGenerateSystemXmlModelPrompt(
                        undefined,
                        false,
                        true
                    );

                    if (promptValue == null) {
                        promptValue = turn.prompt;
                    }
                }

                let request = "";
                if (rest_api) {
                    request += BeginHumanRestMessage;
                    request += `${promptValue}\n`;
                    request += EndHumanRestMessage;
                } else {
                    request += `${HumanMessage} ${promptValue}\n`;
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

    if (rest_api) {
        promptWithContext += BeginHumanRestMessage;
    } else {
        promptWithContext += `${HumanMessage} `;
    }

    promptWithContext += "If the request requires XML or Python code generation, always validate the code for correctness and functionality. Include the validated code as part of your response.";

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
    // if (response === null) {
    //     fs.writeFileSync("/Users/fernando/RTI/AI/demos/demo_plc/prompt.txt", promptWithContext);
    // }

    return promptWithContext;
}

/**
 * Retrieves images from the provided references or from all open files if specified.
 *
 * @param references - An array of chat prompt references or undefined.
 * @param includeAllOpenFiles - A boolean indicating whether to include all open files. Defaults to false.
 * @returns An array of objects containing image data and its type.
 */
export function getImages(
    references: readonly vscode.ChatPromptReference[] | undefined,
    includeAllOpenFiles: boolean = false
) : { image: string; type: string; }[] {
    let promptReferences: PromptReference[] = [];

    if (
        (references != undefined && references.length > 0) ||
        includeAllOpenFiles
    ) {
        promptReferences = chatPromptReferenceToPromptReference(
            references,
            false,
            includeAllOpenFiles
        );
    }

    let images: { image: string; type: string; }[] = [];

    if (promptReferences.length == 0) {
        return images;
    }

    for (let ref of promptReferences) {
        if (ref.kind == PromptReferenceKind.File) {
            let fileRef = ref as FilePromptReference;

            if (fileRef.content == undefined || fileRef.uri == undefined) {
                continue;
            }

            let extension = fileRef.uri.fsPath.split(".").pop();

            images.push({
                image: fileRef.content,
                type: `image/${extension?.toLowerCase()}`,
            });
        }
    }

    return images;
}

/**
 * Enum representing different types of system representations.
 */
export enum SystemRepresentation {
    Image,
    DrawIO,
    Unknown,
}

/**
 * Converts a `SystemRepresentation` enum value to its corresponding string representation.
 *
 * @param system_representation - The `SystemRepresentation` enum value to convert.
 * @returns The string representation of the given `SystemRepresentation` value.
 *          Returns "image" for `SystemRepresentation.Image`, "draw.io" for `SystemRepresentation.DrawIO`,
 *          and "unknown" for any other value.
 */
function getSystemRepresentationStr(system_representation: SystemRepresentation): string {
    switch (system_representation) {
        case SystemRepresentation.Image:
            return "image";
        case SystemRepresentation.DrawIO:
            return "draw.io";
        default:
            return "unknown";
    }
}

/**
 * Generates a prompt for creating a complete and valid RTI DDS system configuration
 * in OMG XML format based on the provided references and open files.
 *
 * @param references - An array of chat prompt references, which can be undefined.
 * @param includeAllOpenFiles - A boolean indicating whether to include all open files in the prompt generation. Defaults to false.
 * @param ignoreReferences - A boolean indicating whether to ignore the provided references. Defaults to false.
 * @returns A string containing the generated prompt, or null if the system representation is unknown.
 */
export function getGenerateSystemXmlModelPrompt(
    references: readonly vscode.ChatPromptReference[] | undefined,
    includeAllOpenFiles: boolean = false,
    ignoreReferences: boolean = false
): string | null {
    let promptReferences: PromptReference[] = [];
    let source_str = ""

    if (!ignoreReferences) {
        if (
            (references != undefined && references.length > 0) ||
            includeAllOpenFiles
        ) {
            promptReferences = chatPromptReferenceToPromptReference(
                references,
                false,
                includeAllOpenFiles
            );
        }

        let source = SystemRepresentation.Unknown;

        for (let ref of promptReferences) {
            if (ref.kind == PromptReferenceKind.File) {
                let refFile = ref as FilePromptReference;
                if (refFile.sytemRepresentationKind == SystemRepresentation.Image) {
                    source = SystemRepresentation.Image;
                    break;
                } else if (refFile.sytemRepresentationKind == SystemRepresentation.DrawIO) {
                    source = SystemRepresentation.DrawIO;
                    break;
                }
            }
        }

        if (source == SystemRepresentation.Unknown) {
            return null;
        }
        
        source_str = getSystemRepresentationStr(source);
    }

    return `**Generate a complete and valid RTI DDS system configuration in 
    OMG XML from the ${source_str} diagram in the open files.** 
    
    The response must strictly include the validated XML code. The configuration
    for the input diagram should incorporate the following elements:

    - Data types in XML format
    - QoS settings
    - Domain
    - Topics
    - Data writers
    - Data readers
    - Any additional elements required for a fully operational RTI DDS system

    When defining types try to be as complete as possible. Do not use the
    same type for different kinds of data. Data types that represent
    the value of an object should always include an ID field. You can use
    a tool to get help defining the types.

    All components (e.g, sensor, control unit, etc) should be encapsulated in 
    its own Participant.

    Always preserve the flow of information described by arrows (or lines) in
    the diagram. If a line goes into a component, it will require a DataReader.
    If a line goes out of a component, it will require a DataWriter.

    Always provide a baseline builtin QoS profile for each DataWriter and 
    DataReader. Use a tool to access the builtin QoS profiles.
    `;
}

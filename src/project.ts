/*******************************************************************************
 * (c) Copyright, Real-Time Innovations, 2024.
 * All rights reserved.
 * No duplications, whole or partial, manual or electronic, may be made
 * without express written permission.  Any such copies, or
 * revisions thereof, must display this notice unaltered.
 * This code contains trade secrets of Real-Time Innovations, Inc.
 */

import * as vscode from "vscode";
import * as os from "os";
import * as nunjucks from 'nunjucks';
import * as fs from 'fs';
import * as path from 'path';
import {
    Installation,
    Architecture,
    getDefaultInstallation,
} from "./installation";

import {
    CONNEXT_PRODUCT,
    askQuestionWithJsonResponse,
    askQuestionToConnext,
    runCommandSync,
} from "./utils";
import { error } from "console";
import { json } from "stream/consumers";

function generateCMakeLists(
    workspaceUri: vscode.Uri,
    configurationVariables: Map<string, string>
) {
    const data = {
        cmake_version: "3.11",
        workspace_name: configurationVariables.get("workspace_name"),
        connext_version: configurationVariables.get("connext_version"),
        connext_path: configurationVariables.get("connext_path")
    };

    // Configure Nunjucks to load templates from the specified directory
    nunjucks.configure(
        path.resolve(workspaceUri.fsPath, "./resources/templates"),
        {
            autoescape: true,
        }
    );

    // Render the template with data
    const output = nunjucks.render("CMakeLists.txt.njk", data);

    // Write the output to a file
    const outputPath = path.resolve(__dirname, "../CMakeLists.txt");
    fs.writeFileSync(outputPath, output);
}

export async function createExample(
    prompt: string,
    installations: Installation[] | undefined,
    stream: vscode.ChatResponseStream,
    accessCode: string | undefined,
    cancel_token: vscode.CancellationToken
): Promise<void> {
    const tempDir = undefined;
    let ok = false;

    if (accessCode == undefined) {
        stream.markdown(`please log in to ${CONNEXT_PRODUCT} to continue.`);
        return;
    }

    try {
        // First check if there is a default connext installation and architecture
        let defaultInstallation = undefined;

        if (installations != undefined) {
            defaultInstallation = getDefaultInstallation(installations);
        }

        if (defaultInstallation == undefined) {
            stream.markdown(
                "I couldn't find any default Connext DDS installation and architecture. Use the command /connextInfo to set one."
            );
            return;
        }

        stream.progress("Analyzing request ...");

        // Generate the project information
        const jsonProject = await askQuestionWithJsonResponse(
            `Analyze the following input prompt containing a type definition 
            and target language. Extract the necessary information to generate 
            a JSON configuration for creating a Visual Code Connext DDS 
            workspace.

            Input Prompt: ${prompt}
            
            Expected JSON Response::
            {
                "workspace_name": "<workspace_name>",
                "language": "<language>",
                "idl_file_name": "<idl_file_name>"
            }
            
            Instructions:

            1) Workspace Name (workspace_name):
            * Use the type name from the prompt.
            * Format is in snake_case.

            2) IDL File Name (idl_file_name):
            * Use the type name from the prompt, followed by .idl.
            * Format is in snake_case.

            3) Language (language):
            * Extract the programming language mentioned in the prompt.
            * Supported values: "C", "C++98", "C++11", "Java", "C#", or "Python".
            * Use the following mappings:
            - "C++" -> "C++11"
            - "traditional C++" -> "C++98"
            - "modern C++" -> "C++11"
            * If the language is not specified, set it to "C++11".

            Example Prompt and Response:

            Input Prompt: "Temperature sensor in C++"

            {
                "workspace_name": "temperature_sensor",
                "language": "C++11",
                "idl_file_name": "temperature_sensor.idl"
            }`,
            cancel_token
        );

        jsonProject["connext_path"] = defaultInstallation[0].directory;
        jsonProject["architecture"] = defaultInstallation[1].name;
        jsonProject["connext_version"] = defaultInstallation[0].version;

        // Create a temporary directory for the content
        let tempDir = vscode.Uri.file(os.tmpdir());
        const tempWorkspaceName = `${jsonProject.workspace_name}`;
        let tempDirWithWorkspace = vscode.Uri.joinPath(
            tempDir,
            tempWorkspaceName
        );
    
        // Delete the temporary directory if it already exists
        try {
            await vscode.workspace.fs.delete(tempDirWithWorkspace, {
                recursive: true,
            });
        } catch (error) {
            // Ignore error if the directory does not exist
        }
        
        await vscode.workspace.fs.createDirectory(tempDirWithWorkspace);

        // Generate IDL file
        stream.progress("Generating IDL file ...");

        let idlType = await askQuestionToConnext(
            `Generate a IDL file based in the description in the following prompt.
            Provide only the IDL.
            Prompt: ${prompt}`,
            accessCode,
            cancel_token
        );

        if (idlType == undefined) {
            throw new Error("Error generating IDL file.");
        }

        idlType = idlType.replace("```idl", "");
        idlType = idlType.replace("```", "");

        // Write IDL file to the temporary directory
        const idlFile = vscode.Uri.joinPath(
            tempDirWithWorkspace,
            jsonProject.idl_file_name
        );

        await vscode.workspace.fs.writeFile(
            idlFile,
            new TextEncoder().encode(idlType)
        );

        // Generate code from IDL file
        stream.progress("Generating code from IDL file ...");

        let exampleArch = jsonProject.architecture;

        if (jsonProject.language == "Python") {
            exampleArch = "universal";
        } else if (jsonProject.language == "C#") {
            exampleArch = "net8";
        }

        // if defaultInstallation[1].toolEnvCmd contains zsh
        // then replace it with bash
        let command = `${defaultInstallation[1].toolEnvCmd} && rtiddsgen \
                    -language ${jsonProject.language} \
                    -d ${tempDirWithWorkspace.fsPath} \
                    -example ${exampleArch} ${idlFile.fsPath}`;
        runCommandSync(command);

        // Get the list of files from the temp directory
        const files = await vscode.workspace.fs.readDirectory(
            tempDirWithWorkspace
        );

        if (files == undefined) {
            throw new Error("Error reading temporary directory.");
        }

        // Delete files starting with makefile or README
        const filteredFiles = files.filter(([fileName]) => {
            const lowerFileName = fileName.toLowerCase();
            if (lowerFileName.startsWith('makefile') || lowerFileName.startsWith('readme')) {
                try {
                    const fileUri = vscode.Uri.joinPath(tempDirWithWorkspace, fileName);
                    vscode.workspace.fs.delete(fileUri);
                    return false; // exclude from filtered results
                } catch (error) {
                    throw new Error("Error deleting unnecessary files.");
                }
            }
            return true; // keep non-matching files
        });

        files.length = 0;
        filteredFiles.forEach((file) => files.push(file));

        // Remove path from files
        let filesWithoutPath: string[] = [];

        for (let file of files) {
            filesWithoutPath.push(file[0]);
        }

        // Generate proposed directory structure and content
        stream.progress("Creating directory structure ...");

        let children = [];
        for (let file of filesWithoutPath) {
            children.push({ name: file });
        }

        let tree: vscode.ChatResponseFileTree[] = [
            {
                name: jsonProject.workspace_name,
                children: children,
            },
        ];

        stream.markdown(
            `Here's a proposed directory structure for the ${jsonProject.workspace_name} workspace:\n`
        );

        stream.filetree(tree, tempDir);

        stream.button({
            command: "connext-vc-copilot.create-workspace",
            title: vscode.l10n.t("Accept and create workspace"),
            arguments: [
                stream,
                jsonProject.workspace_name,
                tempDirWithWorkspace,
            ],
        });

        ok = true;
    } catch (error) {
        stream.markdown(
            "An error occurred while creating the example: " + error
        );
    } finally {
        if (!ok && tempDir != undefined) {
            await vscode.workspace.fs.delete(tempDir, { recursive: true });
        }
    }
}

/**
 * Initializes the workspace by copying contents from the scratchpad directory to the parent directory.
 *
 * @param stream - The stream to which messages can be written.
 * @param configurationVariables - The configuration variables used to generate the workspace.
 * @param parentDirUri - The URI of the parent directory where the contents will be copied. The
 * workspace directory will be created here.
 * @param scratchpadDirUri - The URI of the scratchpad directory from which the contents will be copied.
 * @returns A promise that resolves when the copying is complete.
 */
export async function initializeWorkspace(
    stream: vscode.ChatResponseStream,
    configurationVariables: Map<string, string>,
    parentDirUri: vscode.Uri,
    scratchpadDirUri: vscode.Uri
): Promise<void> {
    try {
        if (configurationVariables.get("workspace_name") == undefined) {
            throw new Error("Workspace name not found.");
        }

        // Create the workspace directory under workspaceName
        const workspaceName = configurationVariables.get(
            "workspace_name"
        ) as string;
        const workspaceDirUri = vscode.Uri.joinPath(
            parentDirUri,
            workspaceName
        );
        await vscode.workspace.fs.createDirectory(workspaceDirUri);

        // Copy to the scratchpad URI
        await vscode.workspace.fs.copy(scratchpadDirUri, workspaceDirUri, {
            overwrite: true,
        });

        // Open the workspace
        await vscode.commands.executeCommand(
            "vscode.openFolder",
            workspaceDirUri
        );
    } catch (error) {
        stream.markdown(
            "An error occurred while creating the example: " + error
        );
    } finally {
        await vscode.workspace.fs.delete(scratchpadDirUri, { recursive: true });
    }
}

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
            `Analyze the following prompt containing a type definition and a 
            target language and provide the information needed to 
            create a Visual Code Connext DDS workspace in JSON format:
            
            Prompt: ${prompt}
            
            Response:
            {
                "workspace_name": "my_project",
                "language": "C++",
                "idl_file_name": "my_project.idl"
                "connext_path": "${defaultInstallation[0].directory}",
                "architecture": "${defaultInstallation[1].name}"
            }
            
            Instructions:
            * "workspace_name" refers to the name of the workspace that will be 
            created. Use a snake_case format name including the
            type name.
            * "idl_file_name" refers to the name of the OMG IDL file that will be 
            created. Use a snake_case format name including the
            type name.
            * "language" can have the following values: "C", "C++98", "Java", 
            "C++11", "C#", "Python" or "unknown". Traditional C++ is C++98, 
            while C++ or modern C++ is C++11.
            * If the "language" is not specified, set it to "unknown"

            For example, for the prompt "Temperature sensor in C++", the response 
            would be:

            {
                "workspace_name": "temperature_sensor",
                "language": "C++",
                "idl_file_name": "temperature_sensor.idl",
                "connext_path": "/path/to/rti_connext_dds",
                "architecture": "C++11"
            }`,
            cancel_token
        );

        // Create a temporary directory for the content
        let tempDir = vscode.Uri.file(os.tmpdir());
        let tempDirWithWorkspace = vscode.Uri.joinPath(
            tempDir,
            jsonProject.workspace_name
        );
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

        const baseLocation = vscode.Uri.file(os.homedir());

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
 * @param workspaceName - The name of the workspace directory to be created.
 * @param parentDirUri - The URI of the parent directory where the contents will be copied. The
 * workspace directory will be created here.
 * @param scratchpadDirUri - The URI of the scratchpad directory from which the contents will be copied.
 * @returns A promise that resolves when the copying is complete.
 */
export async function initializeWorkspace(
    stream: vscode.ChatResponseStream,
    workspaceName: string,
    parentDirUri: vscode.Uri,
    scratchpadDirUri: vscode.Uri
): Promise<void> {
    try {
        // Create the workspace directory under workspaceName
        const workspaceDirUri = vscode.Uri.joinPath(
            parentDirUri,
            workspaceName
        );
        await vscode.workspace.fs.createDirectory(workspaceDirUri);

        // Copy to the scratchpad URI
        await vscode.workspace.fs.copy(scratchpadDirUri, workspaceDirUri, {
            overwrite: true,
        });
    } catch (error) {
        stream.markdown(
            "An error occurred while creating the example: " + error
        );
    } finally {
        await vscode.workspace.fs.delete(scratchpadDirUri, { recursive: true });
    }
}

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
    runCommand
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
            `Analyze the following prompt and provide the information needed to 
            create a Connext DDS workspace in JSON format:
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
            * "idl_file_name" refers to the name of the OMG IDL file that will be 
            created
            * "language" can have the following values: "C", "C++98", "Java", "C++11", "C#", "Python" or "unknown"
            * If the "language" is not specified, set it to "unknown"`,
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
        
        let command =
            `${defaultInstallation[1].toolEnvCmd} && rtiddsgen
                    -language ${jsonProject.language}
                    -d ${tempDirWithWorkspace.fsPath}
                    -example ${exampleArch} ${idlFile.fsPath}`;
        runCommand(command);

        // Get the list fo files from the temp directory
        const files = await vscode.workspace.fs.readDirectory(tempDirWithWorkspace);

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
            command: "connext-vc-copilot.validate-code",
            title: vscode.l10n.t("Accept and create workspace"),
            arguments: [tempDir],
        });

        ok = true;
    } catch (error) {
        stream.markdown("An error occurred while creating the example: " + error);
    } finally {
        if (!ok && tempDir != undefined) {
            await vscode.workspace.fs.delete(tempDir);
        }
    }
}

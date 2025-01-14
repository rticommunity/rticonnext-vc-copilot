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
import * as nunjucks from "nunjucks";
import * as fs from "fs";
import * as path from "path";
import {
    Installation,
    Architecture,
    getDefaultInstallation,
} from "./installation";

import {
    CONNEXT_PRODUCT,
    askQuestionWithJsonResponse,
    askQuestionToConnext,
    askQuestionToConnextWithJsonResponse,
    runCommandSync,
    isWindows,
    isLinux,
    isMac,
    readDirectoryRecursive,
    getPlatformStr,
    getHighestDotnetFramework,
    getLanguageInfo,
    readTextFile,
    writeTextFile,
} from "./utils";
import { error } from "console";
import { json } from "stream/consumers";

/**
 * Generates CMake configuration files for a given workspace.
 *
 * This function creates the following files in the specified workspace:
 * - `CMakeLists.txt`
 * - `CMakePresets.json`
 * - `.vscode/launch.json`
 *
 * The function uses Nunjucks templates to render the content of these files
 * based on the provided configuration variables.
 *
 * @param workspaceUri - The URI of the workspace where the files will be generated.
 * @param extensionPath - The path to the extension's resources directory.
 * @param configurationVariables - An object containing configuration variables.
 *
 * @returns A promise that resolves when the files have been successfully generated.
 */
async function generateCMakeFiles(
    workspaceUri: vscode.Uri,
    extensionPath: string,
    configurationVariables: any
) {
    let idl_file_name_no_ext = configurationVariables.idl_file_name.replace(
        ".idl",
        ""
    );

    let data = {
        cmake_version: "3.11",
        workspace_name: configurationVariables.workspace_name,
        connext_version: configurationVariables.connext_version,
        connext_path: configurationVariables.connext_path,
        language: configurationVariables.language,
        idl_file_name: idl_file_name_no_ext,
        connext_libs: "RTIConnextDDS::c_api",
        generator: "Unix Makefiles",
        mi_mode: "lldb",
        platform: getPlatformStr(),
        architecture: configurationVariables.architecture,
    };

    if (configurationVariables.language == "C") {
        data.connext_libs = "RTIConnextDDS::c_api";
    } else if (configurationVariables.language == "C++98") {
        data.connext_libs = "RTIConnextDDS::cpp_api";
    } else if (configurationVariables.language == "C++11") {
        data.connext_libs = "RTIConnextDDS::cpp2_api";
    }

    let cmakeConfig = vscode.workspace.getConfiguration("cmake");

    if (cmakeConfig.get("generator") != undefined) {
        data.generator = cmakeConfig.get("generator") as string;
    } else if (isWindows()) {
        data.generator = "NMake Makefiles";
    } else {
        data.generator = "Unix Makefiles";
    }

    if (isMac()) {
        data.mi_mode = "lldb";
    } else if (isLinux()) {
        data.mi_mode = "gdb";
    } else if (isWindows()) {
        data.mi_mode = "cppvsdbg";
    }

    // Configure Nunjucks to load templates from the specified directory
    nunjucks.configure(path.resolve(extensionPath, "resources/templates"), {
        autoescape: true,
    });

    // Render the template with data
    const outputCMake = nunjucks.render("CMakeLists.txt.njk", data);

    const outputCMakePath = path.resolve(workspaceUri.fsPath, "CMakeLists.txt");
    fs.writeFileSync(outputCMakePath, outputCMake);

    const outputPreset = nunjucks.render("CMakePresets.json.njk", data);

    const outputPresetPath = path.resolve(
        workspaceUri.fsPath,
        "CMakePresets.json"
    );
    fs.writeFileSync(outputPresetPath, outputPreset);

    const outputLaunch = nunjucks.render("launch.json.njk", data);

    let vscodeUri = vscode.Uri.joinPath(workspaceUri, ".vscode");
    await vscode.workspace.fs.createDirectory(vscodeUri);

    const outputLaunchPath = path.resolve(
        workspaceUri.fsPath,
        ".vscode",
        "launch.json"
    );

    fs.writeFileSync(outputLaunchPath, outputLaunch);
}

/**
 * Generates Java project files for a given workspace.
 *
 * This function creates and configures the necessary files for a Java project
 * in the specified workspace. It uses Nunjucks templates to generate the
 * `launch.json` and `settings.json` files based on the provided configuration
 * variables.
 *
 * @param workspaceUri - The URI of the workspace where the project files will be generated.
 * @param extensionPath - The path to the extension's resources directory.
 * @param configurationVariables - An object containing configuration variables.
 */
async function generateJavaProjectFiles(
    workspaceUri: vscode.Uri,
    extensionPath: string,
    configurationVariables: any
) {
    let data = {
        connext_path: configurationVariables.connext_path,
        architecture: configurationVariables.architecture,
        publisher_class: configurationVariables.publisher_class,
        subscriber_class: configurationVariables.subscriber_class,
        platform: getPlatformStr(),
    };

    // Configure Nunjucks to load templates from the specified directory
    nunjucks.configure(path.resolve(extensionPath, "resources/templates"), {
        autoescape: true,
    });

    // Render the template with data
    const outputLaunch = nunjucks.render("launch.java.json.njk", data);
    let vscodeUri = vscode.Uri.joinPath(workspaceUri, ".vscode");
    await vscode.workspace.fs.createDirectory(vscodeUri);

    const outputLaunchPath = path.resolve(
        workspaceUri.fsPath,
        ".vscode",
        "launch.json"
    );

    fs.writeFileSync(outputLaunchPath, outputLaunch);

    const outputSettings = nunjucks.render("settings.java.json.njk", data);

    const outputSettingsPath = path.resolve(
        workspaceUri.fsPath,
        ".vscode",
        "settings.json"
    );

    fs.writeFileSync(outputSettingsPath, outputSettings);
}

/**
 * Generates Python project files for a given workspace.
 *
 * This function configures Nunjucks to load templates from a specified directory,
 * renders the template with provided data, and writes the output to the `.vscode/launch.json` file
 * in the given workspace.
 *
 * @param workspaceUri - The URI of the workspace where the project files will be generated.
 * @param extensionPath - The path to the extension's resources directory.
 * @param configurationVariables - An object containing configuration variables, including:
 *   - `publisher_file`: The path to the publisher file.
 *   - `subscriber_file`: The path to the subscriber file.
 *
 * @returns A promise that resolves when the project files have been successfully generated.
 */
async function generatePythonProjectFiles(
    workspaceUri: vscode.Uri,
    extensionPath: string,
    configurationVariables: any
) {
    let data = {
        publisher_file: configurationVariables.publisher_file,
        subscriber_file: configurationVariables.subscriber_file,
    };

    // Configure Nunjucks to load templates from the specified directory
    nunjucks.configure(path.resolve(extensionPath, "resources/templates"), {
        autoescape: true,
    });

    // Render the template with data
    const outputLaunch = nunjucks.render("launch.python.json.njk", data);
    let vscodeUri = vscode.Uri.joinPath(workspaceUri, ".vscode");
    await vscode.workspace.fs.createDirectory(vscodeUri);

    const outputLaunchPath = path.resolve(
        workspaceUri.fsPath,
        ".vscode",
        "launch.json"
    );

    fs.writeFileSync(outputLaunchPath, outputLaunch);
}

/**
 * Generates C# project files for the given workspace.
 *
 * This function takes the workspace URI, extension path, and configuration variables,
 * and generates the necessary C# project files using Nunjucks templates.
 *
 * @param workspaceUri - The URI of the workspace where the project files will be generated.
 * @param extensionPath - The path to the extension's resources directory.
 * @param configurationVariables - An object containing configuration variables, including:
 *   - idl_file_name: The name of the IDL file.
 *   - example_architecture: The architecture example to be used.
 *
 * @returns A promise that resolves when the project files have been generated.
 */
async function generateCSProjectFiles(
    workspaceUri: vscode.Uri,
    extensionPath: string,
    configurationVariables: any
) {
    let idl_file_name_no_ext = configurationVariables.idl_file_name.replace(
        ".idl",
        ""
    );

    let data = {
        idl_file_name: idl_file_name_no_ext,
        example_architecture: configurationVariables.example_architecture,
    };

    // Configure Nunjucks to load templates from the specified directory
    nunjucks.configure(path.resolve(extensionPath, "resources/templates"), {
        autoescape: true,
    });

    // Render the template with data
    const outputLaunch = nunjucks.render("launch.net.json.njk", data);
    let vscodeUri = vscode.Uri.joinPath(workspaceUri, ".vscode");
    await vscode.workspace.fs.createDirectory(vscodeUri);

    const outputLaunchPath = path.resolve(
        workspaceUri.fsPath,
        ".vscode",
        "launch.json"
    );

    fs.writeFileSync(outputLaunchPath, outputLaunch);
}

/**
 * Retrieves the publisher and subscriber files for a given language within a workspace.
 *
 * @param workspaceUri - The URI of the workspace to search within.
 * @param language - The programming language to filter files by.
 * @returns A promise that resolves to an array containing the paths of the publisher and subscriber files.
 * @throws Will throw an error if the language is unexpected, if there is an error reading the directory, or if the publisher or subscriber files cannot be found.
 */
export async function getPublisherAndSubscriberFile(
    workspaceUri: vscode.Uri,
    language: string
): Promise<string[]> {
    let languageInfo = getLanguageInfo(language);

    if (languageInfo == undefined) {
        throw new Error("Unexpected language.");
    }

    const files = await readDirectoryRecursive(workspaceUri);

    if (files == undefined) {
        throw new Error("Error reading temporary directory.");
    }

    let publisherFile = undefined;
    let subscriberFile = undefined;

    if (
        language == "Python" ||
        language == "C" ||
        language == "C++98" ||
        language == "C++11"
    ) {
        publisherFile = files.find(([fileName]) => {
            return fileName.endsWith(`_publisher.${languageInfo.extension}`);
        });
        subscriberFile = files.find(([fileName]) => {
            return fileName.endsWith(`_subscriber.${languageInfo.extension}`);
        });
    } else {
        publisherFile = files.find(([fileName]) => {
            return fileName.endsWith(`Publisher.${languageInfo.extension}`);
        });
        subscriberFile = files.find(([fileName]) => {
            return fileName.endsWith(`Subscriber.${languageInfo.extension}`);
        });
    }

    if (publisherFile == undefined || subscriberFile == undefined) {
        throw new Error(`Error finding ${language} files.`);
    }

    return [publisherFile[0], subscriberFile[0]];
}

/**
 * Customizes the publisher or subscriber file based on user instructions.
 *
 * @param publisher - A boolean indicating whether to customize the publisher file (true) or the subscriber file (false).
 * @param workspaceUri - The URI of the workspace where the files are located.
 * @param language - The programming language of the files to be customized.
 * @param userPrompt - The user-provided instructions for customizing the file.
 * @param accessCode - The access code required to interact with the Connext service.
 * @param cancel_token - A token to signal cancellation of the customization process.
 * @throws Will throw an error if the language is unexpected or if there is an error during customization.
 */
async function customizePublisherAndSubscriberFile(
    publisher: boolean,
    workspaceUri: vscode.Uri,
    idlFileName: string,
    language: string,
    userPrompt: string,
    accessCode: string,
    cancel_token: vscode.CancellationToken
) {
    let pubAndSubFiles = await getPublisherAndSubscriberFile(
        workspaceUri,
        language
    );

    let file = vscode.Uri.joinPath(
        workspaceUri,
        publisher ? pubAndSubFiles[0] : pubAndSubFiles[1]
    );

    let languageInfo = getLanguageInfo(language);

    if (languageInfo == undefined) {
        throw new Error("Unexpected language.");
    }

    let fileContent = await readTextFile(file.fsPath);

    let idlFile = vscode.Uri.joinPath(workspaceUri, idlFileName);

    let idlFileContent = await readTextFile(idlFile.fsPath);

    let pubSubStr = publisher ? "publisher" : "subscriber";

    let customizePrompt = `Based on the provided instructions and the IDL type 
    definition, determine if any modifications are needed to the provided 
    ${pubSubStr} code. Provide the full updated code. If no modifications are 
    needed, leave the code as is.

    Do not provide any explanations of what the changes are. Only provide the
    updated code. If the user provides a topic name do not forget to update the
    topic name in the code.
    
    Instructions:

    ${userPrompt}

    IDL type definition:

    \`\`\`idl
    ${idlFileContent}
    \`\`\`

    Input ${pubSubStr} Code:

    \`\`\`${languageInfo.markupCode}
    ${fileContent}
    \`\`\`
    `;

    let updatedCode = await askQuestionToConnext(
        customizePrompt,
        accessCode,
        cancel_token
    );

    if (updatedCode == undefined) {
        throw new Error(`Error customizing ${pubSubStr} code.`);
    }

    updatedCode = updatedCode.replace("```" + languageInfo.markupCode, "");

    // Remove the closing code block and all lines after
    let index = updatedCode.indexOf("```");
    if (index != -1) {
        updatedCode = updatedCode.substring(0, index);
    }

    await writeTextFile(file.fsPath, updatedCode);
}

/**
 * Creates an example project based on the provided prompt and configurations.
 *
 * @param prompt - The input prompt containing a type definition and target language.
 * @param extensionPath - The path to the extension.
 * @param installations - An array of Connext DDS installations or undefined.
 * @param stream - The stream to send progress and results to.
 * @param accessCode - The access code for authentication or undefined.
 * @param cancel_token - The cancellation token to handle operation cancellation.
 * @returns A promise that resolves when the example project is created.
 *
 * @throws Will throw an error if there is an issue generating the IDL file, 
 *         reading the temporary directory, or deleting unnecessary files.
 */
export async function createExample(
    prompt: string,
    extensionPath: string,
    installations: Installation[] | undefined,
    stream: vscode.ChatResponseStream,
    accessCode: string | undefined,
    cancel_token: vscode.CancellationToken
): Promise<void> {
    const tempDir = undefined;
    const tempDirWithWorkspace = undefined;
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
            
            Expected JSON Response:
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
            let sdk = await getHighestDotnetFramework();

            if (sdk == undefined) {
                sdk = "net8";
            }
            exampleArch = sdk;
        }

        jsonProject["example_architecture"] = exampleArch;

        // if defaultInstallation[1].toolEnvCmd contains zsh
        // then replace it with bash
        let command = `${defaultInstallation[1].toolEnvCmd} && rtiddsgen \
                    -language ${jsonProject.language} \
                    -ppDisable \
                    -d ${tempDirWithWorkspace.fsPath} \
                    -example ${exampleArch} ${idlFile.fsPath}`;
        runCommandSync(command);

        let pubSubFiles = await getPublisherAndSubscriberFile(
            tempDirWithWorkspace,
            jsonProject.language
        );

        if (
            jsonProject.language == "C" ||
            jsonProject.language == "C++98" ||
            jsonProject.language == "C++11"
        ) {
            await generateCMakeFiles(
                tempDirWithWorkspace,
                extensionPath,
                jsonProject
            );
        } else if (jsonProject.language == "Java") {
            jsonProject["publisher_class"] = pubSubFiles[0].replace(
                ".java",
                ""
            );
            jsonProject["subscriber_class"] = pubSubFiles[1].replace(
                ".java",
                ""
            );

            await generateJavaProjectFiles(
                tempDirWithWorkspace,
                extensionPath,
                jsonProject
            );
        } else if (jsonProject.language == "Python") {
            jsonProject["publisher_file"] = pubSubFiles[0].replace(".py", "");
            jsonProject["subscriber_file"] = pubSubFiles[1].replace(".py", "");

            await generatePythonProjectFiles(
                tempDirWithWorkspace,
                extensionPath,
                jsonProject
            );
        } else if (jsonProject.language == "C#") {
            await generateCSProjectFiles(
                tempDirWithWorkspace,
                extensionPath,
                jsonProject
            );
        } else {
            throw new Error("Unexpected language.");
        }

        // Customizing application
        stream.progress("Updating Publisher code ...");

        await customizePublisherAndSubscriberFile(
            true,
            tempDirWithWorkspace,
            jsonProject.idl_file_name,
            jsonProject.language,
            prompt,
            accessCode,
            cancel_token
        );

        stream.progress("Updating Subscriber code ...");

        await customizePublisherAndSubscriberFile(
            false,
            tempDirWithWorkspace,
            jsonProject.idl_file_name,
            jsonProject.language,
            prompt,
            accessCode,
            cancel_token
        );

        // Get the list of files from the temp directory
        const files = await readDirectoryRecursive(tempDirWithWorkspace);

        if (files == undefined) {
            throw new Error("Error reading temporary directory.");
        }

        // Delete files starting with makefile or README
        const filteredFiles = files.filter(([fileName]) => {
            const lowerFileName = fileName.toLowerCase();
            if (
                lowerFileName.startsWith("makefile") ||
                lowerFileName.startsWith("readme") ||
                lowerFileName.endsWith(".launch") ||
                lowerFileName.endsWith("build.xml") ||
                lowerFileName.endsWith(".classpath") ||
                lowerFileName.endsWith(".project") ||
                lowerFileName.endsWith(".vcxproj") ||
                lowerFileName.endsWith(".vcxproj.filters") ||
                lowerFileName.endsWith(".sln")
            ) {
                try {
                    const fileUri = vscode.Uri.joinPath(
                        tempDirWithWorkspace,
                        fileName
                    );
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
            arguments: [stream, jsonProject, tempDirWithWorkspace],
        });

        ok = true;
    } catch (error) {
        stream.markdown(
            "An error occurred while creating the example: " + error
        );
    } finally {
        if (!ok && tempDirWithWorkspace != undefined) {
            await vscode.workspace.fs.delete(tempDirWithWorkspace, {
                recursive: true,
            });
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
    configurationVariables: any,
    parentDirUri: vscode.Uri,
    scratchpadDirUri: vscode.Uri
): Promise<void> {
    try {
        // Create the workspace directory under workspaceName
        const workspaceDirUri = vscode.Uri.joinPath(
            parentDirUri,
            configurationVariables.workspace_name
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

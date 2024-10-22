# Welcome to Connext for Github Copilot

This Visual Code extension brings the power of 
[Connext Chatbot](https://chatbot.rti.com/) to Github Copilot Chat.

For documentation on how to use Connext Chatbot, please visit the
[Connext Chatbot documentation](https://chatbot.rti.com/static/doc/html/getting_started.html).

To access the Connext expert, simply type `@connext` followed by your 
question in the Copilot chat window.

## Requirements

To access the Connext expert, you need the following:

* An account on [Connext Chatbot](https://chatbot.rti.com/)
* A Copilot license

You will also need to install the GitHub Copilot Chat extension.

## Features

**Chat View**: You can get assistance from the Connext expert directly in the 
Copilot chat window by typing `@connext` followed by your question.

![Chat view](images/chat_view.gif)

**Quick Chat**: Initiate a brief conversation by opening Quick Chat with the 
"Chat: Open Quick Chat" command or by using the keyboard shortcut Ctrl+Shift+I 
or Cmd+Shift+I. This is useful for asking short, specific questions or getting 
quick help during coding—simply type `@connext` followed by your question in 
the chat window.

![Quick chat](images/quick_chat.gif)

**Context menu**: You can obtain help from the Connext expert by right-clicking 
on a section of code, selecting "Connext" from the context menu, and choosing 
one of the available options.

![Quick chat](images/context_menu.gif)

## Commands

This extension allows invoking pre-defined commands from the chat window by 
typing `@connext` followed by the `/<command>`.

The available commands are:

* `/connextInfo`: Displays information about the Connext versions installed
    on your system. If there are multiple versions installed, the expert will
    ask you to choose which one you want to use as the default.
* `/startAdminConsole`: Opens RTI Admin Console using the default installation.
* `/startSystemDesigner`: Opens the RTI System Designer using the default
    installation.
* `/startMonitorUI`: Opens the RTI Monitor UI using the default installation.
* `/startShapesDemo`: Starts the RTI Shapes Demo using the default installation.

The commands that start tools will fail if there is no default installation
configured.

## Extension Settings

To use the Connext for Github Copilot extension, you need to login to your
Connext Chatbot account.

You can do that by opening the command palette and selecting "Connext: Login".

You can log out of your Connext Chatbot account by opening the command palette
and selecting "Connext: Logout".

If you do not log in, the Connext expert will ask you to log in when you try to
ask a question.

## Release Notes

### 0.0.2 (Beta)

Added support for commands to start RTI tools from the chat window and
to show information about the Connext versions installed on your system.

Added support for streaming.

### 0.0.1 (Beta)

Initial release of Connext for Github Copilot

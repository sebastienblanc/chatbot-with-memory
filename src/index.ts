import {
    Llm,
    InferencingModels,
    HandleRequest,
    HttpRequest,
    HttpResponse,
    Redis
} from "@fermyon/spin-sdk"

const model = InferencingModels.Llama2Chat
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const redisAddress = "rediss://your-redis-address"

interface ChatRequest {
    id?: number,
    context?: string,
    prompt: string
}

interface ChatResponse {
    id: number,
    prompt: string,
    reply: string,
    context?: string,
    timestamp?: string,
    numberOfTokens: number
}

const PROMPT = `\
[INST]
<<SYS>>
{CONTEXT}
It is currently : {CURRENT_TIME}
{HISTORY}
<</SYS>>
{SENTENCE}
[/INST]
`;

const CONTEXT_PREFIX_KEY = "chat:context:"
const CHAT_PREFIX_KEY = "chat:"
const CHATID_KEY = "chatId"

const HISTORY_OFFSET_KEY = "chat:history:offset:"
const CONTEXT_LENGTH = 3500

export const handleRequest: HandleRequest = async function (request: HttpRequest): Promise<HttpResponse> {
    let chatRequest = request.json() as ChatRequest
    let chatResponse: ChatResponse;
    let finalPrompt: string;
    if (chatRequest.id === undefined && chatRequest.context !== undefined) {
        const chatId = initChat()
        finalPrompt = generatePrompt(chatRequest.context, chatRequest.prompt, "[]")
        chatResponse = generateChatResponse(chatId, chatRequest, Llm.infer(model, finalPrompt))
        addMemory(CHAT_PREFIX_KEY + chatId, chatResponse);
        setContext(chatId, chatRequest);
    } else {
        finalPrompt = generatePrompt(getContext(chatRequest), chatRequest.prompt, getHistory(chatRequest))
        chatResponse = generateChatResponse(BigInt(chatRequest.id || 0), chatRequest, Llm.infer(model, finalPrompt))
        addMemory(CHAT_PREFIX_KEY + chatRequest.id, chatResponse);
    }

    return {
        status: 200,
        headers: {"content-type": "text/json"},
        body: JSON.stringify(chatResponse)
    }
}

function generateChatResponse(chatId: bigint, chatRequest: ChatRequest, inferResponse: any): ChatResponse {
    return {
        id: Number(chatId),
        prompt: chatRequest.prompt,
        context: chatRequest.context,
        reply: inferResponse.text,
        timestamp: Date(),
        numberOfTokens: inferResponse.usage.generatedTokenCount + inferResponse.usage.promptTokenCount
    }
}

function generatePrompt(context: string, sentence: string, history: any): string {
    let prompt = PROMPT.replace("{CONTEXT}", context)
    prompt = prompt.replace("{CURRENT_TIME}", Date())
    prompt = prompt.replace("{SENTENCE}", sentence)
    if (history === "[]") {
        prompt = prompt.replace("{HISTORY}", "")
    } else {
        prompt = prompt.replace("{HISTORY}", generateHistory(convertHistory(history)))
    }
    console.log(prompt)
    return prompt
}

function generateHistory(rawHistory: any[]): string {
    let history = `\
Here is the chat history: 

  `;
    //iterate over the history and add it to the history string
    rawHistory.forEach(rawChat => {
        let chat = rawChat as ChatResponse
        let chatHistory = "---- \n" + chat.timestamp + " user: " + chat.prompt + "\n" + chat.timestamp + " bot: " + chat.reply + "\n"
        history = history.concat(chatHistory)
    })
    return history
}

function convertHistory(history: any) {
    console.log(history)
    let result: string = ""
    const values: number[] = history.toString().split(',').map(Number)
    values.forEach((value: number) => {
        result +=  String.fromCharCode(value)
    })
    result = result.replace(/}{/g, '},{')
    return JSON.parse("[" + result + "]");
}

//Memory functions
//TODO refactor to a separate module and add tests for it


function addMemory(chatKey: string, chatResponse: ChatResponse) {
    let historyCount: bigint = Redis.execute(redisAddress, "ZCARD", [encoder.encode(chatKey).buffer]) as bigint
    historyCount = historyCount++
    Redis.execute(redisAddress, "ZINCRBY", [encoder.encode(chatKey).buffer, BigInt(historyCount), encoder.encode(JSON.stringify(chatResponse)).buffer])
    if(chatResponse.numberOfTokens > CONTEXT_LENGTH) {  
      Redis.incr(redisAddress, HISTORY_OFFSET_KEY + chatResponse.id);
    }
}

function setContext(chatId: bigint, chatRequest: ChatRequest) {
    Redis.set(redisAddress, CONTEXT_PREFIX_KEY + chatId, encoder.encode(chatRequest.context).buffer)
}

function getContext(chatRequest: ChatRequest) {
    return decoder.decode(Redis.get(redisAddress, CONTEXT_PREFIX_KEY + chatRequest.id));
}

function getHistory(chatRequest: ChatRequest) {
    return Redis.execute(redisAddress, "ZRANGE", [encoder.encode(CHAT_PREFIX_KEY + chatRequest.id).buffer, BigInt(decoder.decode(Redis.get(redisAddress, HISTORY_OFFSET_KEY + chatRequest.id))) , BigInt(-1)]);
}

function initChat() {
    return Redis.incr(redisAddress, CHATID_KEY);
}
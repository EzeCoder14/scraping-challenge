import { chromium, Download, Page } from "playwright";
import axios, {AxiosResponse} from "axios";
import pdfParse from "pdf-parse";
import fs from 'fs/promises';
import path from "path";

type ChallengeResponse = {
    vault: string[],
    targets: number[]
}

// Define an interface for the expected response data (optional, for type safety)
interface ApiResponse {
  // Replace with the actual shape of your API response
  challenge: ChallengeResponse;
  status: number;
  statusText: string;
}

const URL = "https://pruebatecnica-sherpa-production.up.railway.app/login"
const EMAIL = "monje@sherpa.local";
const PASSWORD = "cript@123";
// Funtion to scrape a webpage using Playwright
async function scrapeWebpage(url:string) {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    // Navegar a la cripta
    await page.goto(url);
    console.log(`open page "${url}"`);

    // Fill in the email field
    await page.fill('#email', EMAIL);
    console.log(`Filled Email:"${EMAIL}"`);
    
    // Fill in the password field
    await page.fill('#password', PASSWORD);
    console.log(`Filled Password:"${EMAIL}"`);
    
    // Click the submit button (selects any button or input with type="submit")
    await page.click('[type="submit"]');
    console.log('login success');

    // Get XIV element
    const selectSelector = 'select.w-full.px-3.py-2.rounded-md'; // CSS selector for the <select> element
    const options = ['XIV', 'XV', 'XVI', 'XVII', 'XVIII'];
    let password = '';
    let buttonSelector = 'button.flex.items-center.justify-center.gap-2.px-4.py-2.rounded-md';
    for (const option of options) {
        await page.selectOption(selectSelector, { value: option });
        console.log(`Clicked "${option}" option`);
        await page.waitForTimeout(1000);
        if(option === 'XVII' || option === 'XVIII') {
            // Get book name
            const book_name = await page.locator('h3.text-lg.font-medium.text-sherpa-text.mb-1').textContent() || '';
            console.log(`Get book name: ${book_name}`);

            await page.click('button.w-full.bg-purple-600\\/20');
            console.log('Open modal');

            await page.waitForTimeout(1000);
            const preSelector = 'div.bg-gray-900\\/50 pre.text-green-400';
            // Verify pre element exists
            const preElement = await page.$(preSelector);
            if (!preElement) {
                throw new Error('Pre element not found');
            }

            // Extract the text content (href value)
            const hrefValue = await page.$eval(preSelector, (el) => el.textContent?.trim() || '');
            if (!hrefValue) {
                throw new Error('Href value not found in pre element');
            }
            console.log('Extracted href value:', hrefValue);
            password = await fetchData(hrefValue, book_name, password);

            await page.click('button.text-sherpa-textSecondary');
            await page.waitForTimeout(1000);
        }
        if (option !== 'XIV') {
            const inputSelector = 'input[placeholder="Ingresá el código"]';
            // Verify input exists
            const input = await page.$(inputSelector);
            if (!input) {
                throw new Error('Password input field not found');
            }
            // Fill the input with the secret password
            await page.fill(inputSelector, password);
            console.log(`Filled input with password: ${password}`);
            await page.waitForTimeout(1000);
            await page.click('[type="submit"]');
            await page.waitForTimeout(1000);

            if (option === 'XVII' || option === 'XVIII') {
                await page.click('button.text-sherpa-textSecondary');
                console.log('close confirm modal');
            }
        }
        const lastPDF = option === 'XVIII';
        password = await downloadAndParsePDF(page,buttonSelector,lastPDF);
    }
}

async function downloadAndParsePDF(page:Page, buttonSelector: string, lastPDF: boolean = false) {
    try {
        // Start waiting for the download event before clicking
        const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
        // Click the button
        await page.click(buttonSelector);
        console.log('Clicked "Descargar PDF" button');

        // Wait for the download to complete
        const download: Download = await downloadPromise;

        // Get the suggested filename and create a safe path
        const suggestedFilename = download.suggestedFilename() || 'downloaded.pdf';
        const outputPath = path.join(process.cwd(), 'downloads', suggestedFilename);

        // Ensure the downloads directory exists
        await fs.mkdir(path.dirname(outputPath), { recursive: true });

        // Save the downloaded file
        await download.saveAs(outputPath);
        console.log(`PDF saved to: ${outputPath}`);

        // Parse the PDF
        const stats = await fs.stat(outputPath);
        if (stats.size < 1000) {
            throw new Error(`Downloaded PDF is too small (${stats.size} bytes), likely corrupted`);
        }

        // Attempt to parse the PDF with pdf-parse
        let pdfText = '';
        try {
            const dataBuffer = await fs.readFile(outputPath);
            const data = await pdfParse(dataBuffer, { max: 1 }); // Limit to first page to test
            pdfText = data.text;
        } catch (parseError) {
            await fs.appendFile('errors.log', `PDF parsing error (pdf-parse): ${parseError}\n`);
            // Fallback: Try parsing with pdfjs-dist
            console.log('Attempting fallback parsing with pdfjs-dist...');
            const { default: PDFJS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
            const dataBuffer = await fs.readFile(outputPath);
            const uint8Array = new Uint8Array(dataBuffer); // Convert Buffer to Uint8Array
            const pdf = await PDFJS.getDocument({ data: uint8Array }).promise;
            const page = await pdf.getPage(1);
            const textContent = await page.getTextContent();
            pdfText = textContent.items.map((item: any) => item.str).join(' ');
        }

        if (lastPDF) {
            console.log(`Last PDF Result: ${pdfText}`);
            return 'Finish!';
        }

        // Extract the secret password
        const passwordMatch = pdfText.match(/acceso: (\w+)/);
        const secretPassword = passwordMatch ? passwordMatch[1] : null;
        if (!secretPassword) {
            throw new Error('Secret password not found in PDF text');
        }
        console.log('Extracted Secret Password:', secretPassword);
        return secretPassword;
    } catch (error) {
        console.error('Error downloading or parsing PDF:', error);
        return '';
    }
}

async function fetchData(url: string, bookTitle:string, unlockCode:string) {
    try {
        // Send GET request
        const response: AxiosResponse<ApiResponse> = await axios.get<ApiResponse>(url, {
            params: {
                bookTitle: bookTitle,
                unlockCode: unlockCode,
            },
            headers: {
                'Content-Type': 'application/json',
            },
        });
        console.log(`Send GET Request to ${url}`);

        const { challenge } = response.data;
        console.log('Vault:', challenge.vault); // Log vault as in original code
        console.log('Target:', challenge.targets);

        // Extract password
        const password = getPassword(challenge);
        console.log('Password:', password);
        return password;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            throw new Error(`Axios Error: ${error.response?.data || error.message}`);
        }
            throw new Error(`Unexpected Error: ${error}`);
    }
}

// Function to extract password from challenge
function getPassword(challenge: ChallengeResponse): string {
    const { vault, targets } = challenge;
    // Validate indices and map to characters
    const password = targets.map(index => {
        if (index < 0 || index >= vault.length) {
            throw new Error(`Invalid index: ${index}`);
        }
        return vault[index];
    }).join('');
    return password;
}

// Main function to run the scraper
async function main() {
    console.log('Start');
    await scrapeWebpage(URL);
    console.log('Success');
}

main().catch((error) => console.error('Main function error:', error));

const fs = require('fs');
const axios = require('axios');
const colors = require('colors');
const args = require('yargs').argv;
const { parse } = require('querystring');
const { DateTime } = require('luxon');

class TapTether {
    constructor () {
        this.headers = {
            'Accept': 'application/json, text/plain, */*',
            "User-Agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, seperti Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        }
        this.hideLogsfail = false; // true: sembunyikan gagal - false: tampilkan gagal
        this.linkData = 'data.txt';
        this.Threads = 60;
        this.forwhile = 600; //Detik
        this.timeAgain = 10; //Waktu respons permintaan, detik
        this.activeThreads = 0;
        this.indexCounter = 0; 
        this.taskQueue = []; // Antrian untuk tugas
        this.nFail = 0;
        this.nPass = 0;
    }

    coverTime(mSeconds) { 
        var hours = Math.floor(mSeconds / 1e3 / 3600);
        var minutes =  Math.floor((mSeconds / 1e3 % 3600) / 60);      
        return hours + ":" + minutes;
    }

    getTime() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        const Time = hours + ':' + minutes + ':' + seconds;
        return Time;
    }

    async loadData(file) {
        const datas = fs.readFileSync(file, 'utf8').split('\n').map(line => line.trim()).filter(line => line.length > 0);
        if (datas.length <= 0) {
            console.log(colors.red(`Tidak ditemukan data`));
            process.exit();
        }
        return datas;
    }

    async countdown(status, t) {
        for (let i = t; i > 0; i--) {
            const hours = String(Math.floor(i / 3600)).padStart(2, '0');
            const minutes = String(Math.floor((i % 3600) / 60)).padStart(2, '0');
            const seconds = String(i % 60).padStart(2, '0');
            if(status == 1){
                process.stdout.write(colors.white(`[Mulai] Proses ulang setelah: ${hours}:${minutes}:${seconds}     \r`));
            } else if(status == 2) {
                while (this.activeThreads > 0) {
                    process.stdout.write(colors.white(`[*] Memuat     \r`));
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    process.stdout.write('                                        \r');
                }
            } else if (status == 3) {
                process.stdout.write(colors.red(`[Axios] Proses pengiriman gagal, mencoba lagi`));
            } else {
                process.stdout.write(colors.white(`[*] Memuat     \r`));
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        process.stdout.write('                                        \r');
    }

    async inforUser(data) {
        const url = 'https://tontether.click/user/me';
        const headers = this.headers;
        const timeAgain = this.timeAgain * 1000;
        this.headers['Authorization'] = 'Bearer ' + data;
        try {
            const res = await axios.get(url, {headers, timeout: timeAgain})
            const data = res.data;
            return data;
        } catch (error) {
            return false;
        };
    }

    async claimCoin(coin, data) {
        const url = 'https://tontether.click/user/click';
        const headers = this.headers;
        const timeAgain = this.timeAgain * 1000;
        this.headers['Authorization'] = 'Bearer ' + data;
        const timeNow = new Date().getTime();
        const datas = {click_count: coin, at: timeNow}
        try {
            const res = await axios.post(url, datas, {headers, timeout: timeAgain})
            const data = res.data;
            return data;
        } catch (error) {
            return false;
        };
    }

    async processAcount(data, index){
        let Balance = 0, Reward = 0, Status = false, isClaim = true, nCountWhile = 0;
        const parser = parse(data);
        const user = JSON.parse(parser.user);
        const id = user.id;
        
        while (isClaim == true) {
            const inforUser = await this.inforUser(data);
            if (inforUser == false) {
                return {index, id, inforUser};
            }
            Status = 'Menunggu';
            Reward = inforUser.data && inforUser.data.last_remaining_clicks;
            Balance = inforUser.data && inforUser.data.usdt_balance.toFixed(5);
            const claimCoin = await this.claimCoin(Reward, data);
            if (claimCoin == false) {
                return {index, id, inforUser: {Balance, Status: false}};
            }
            Status = 'Berhasil';
            Balance = claimCoin.data && claimCoin.data.usdt_balance.toFixed(5);
            const Claim = claimCoin.data && claimCoin.data.last_remaining_clicks;
            if (Claim < 100 || nCountWhile > 3) {
                isClaim = false;
            }
            nCountWhile++;
        }
        return {index, id, inforUser: {Balance, Status, Reward, nCountWhile}};
    }

    logAccount(result, completedThreads) {
        let logs = '';
        logs =  `[${this.getTime()}][${completedThreads}][${result.index}][${colors.green(result.id)}]`;
        if (result.inforUser == false) {
            this.nFail++;
            return this.hideLogsfail == true ? false : logs += `\n\t${colors.yellow(`=> Tidak ditemukan data`)}`;
        }
        logs += ` - USDT: ${colors.green(result.inforUser.Balance)}`;
        logs += result.inforUser.Status == 'Berhasil' ? `\n\t=> Klaim: ${colors.green(result.inforUser.Status)}`: `\n\t=> Klaim: ${colors.yellow(result.inforUser.Status)}`;
        logs += result.inforUser.Reward > 0 ? ` - Hadiah: ${colors.green(result.inforUser.Reward)}`: ` - Hadiah: ${colors.yellow(result.inforUser.Reward)}`;
        logs += result.inforUser.nCountWhile > 1 ? ` - ulang: ${colors.red(result.inforUser.nCountWhile)}`: ` - ulang: ${colors.green(result.inforUser.nCountWhile)}`;

        this.nPass++;
        return logs;
    }

    async processQueque() {
        let completedThreads = 0;
        const Total = this.taskQueue.length;
        while (this.taskQueue.length > 0) {
            if (this.activeThreads < this.Threads) {
                const data = this.taskQueue.shift();
                this.activeThreads++;
                this.processAcount(data, this.indexCounter++)
                    .then((result) => {
                        const logs = this.logAccount(result, completedThreads);
                        if (logs != false) {
                            console.log(logs);
                        }
                    })
                    .catch((error) => {
                        console.error(`Proses untuk data ${data} gagal:`, error);
                    })
                    .finally(() => {
                        this.activeThreads--;
                        completedThreads++;
                    })
            } else {
                await new Promise(resolve => setTimeout(resolve, 100)); // Tunggu 100ms sebelum memeriksa lagi
            }
        }
        await this.countdown(2, 1) //Memuat
        console.log(`Total: ${colors.green(Total)} - Lolos: ${colors.green(this.nPass)} - Gagal: ${colors.red(this.nFail)} (${this.hideLogsfail == true ? 'sembunyikan' : 'tampilkan'})`);
        await this.countdown(1, this.forwhile); //ulang
    }

    async main() {
        let nCountWhile = 0;
        const args = require('yargs').argv;
        const dataFile = args.data || this.linkData;
        const marinkitagawa = args.marinkitagawa || false;
        if (!marinkitagawa) {
            console.clear();
        }
        const datas = await this.loadData(dataFile);
        while(true){
            this.taskQueue = [...datas];
            this.nFail = 0;
            this.nPass = 0;
            this.indexCounter = 0; //reset Index setelah memuat semua data
            console.log(`[${this.getTime()}]==================> Mulai untuk ${colors.green((nCountWhile + 1))} <==================||`);
            await this.processQueque()
                .finally(() => {
                    nCountWhile++;
                })
            console.clear();
        }
    }
}

(async () => {
    try{
        const app = new TapTether();
        await app.main();
    }catch (error){
        console.error(error);
        process.exit();
    }
})()

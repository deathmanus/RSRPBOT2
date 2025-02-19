const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('count_with_time')
        .setDescription('Na počítání basepointů s časy'),
    async execute(interaction) {
        let ListCapture = {};
        let FinalEnd = null;

        const channel = interaction.channel;
        let messages = await channel.messages.fetch({ limit: 100 });

        messages = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        messages.forEach(message => {
            let content = message.embeds[0]?.description || message.content;
            let Capture = content.match(/\*\*(.+)\*\* obsadili basepoint \*\*(.+)\*\* v čase \*\*(.+)\*\*/);
            let EndFinalTime = content.match(/Konec zabírání: \*\*(.+)\*\*/);

            if (Capture) {
                let [_, team, basepoint, time] = Capture;
                let startTime = new Date(`1970-01-01T${time}Z`);

                if (!ListCapture[basepoint]) {
                    ListCapture[basepoint] = { teams: [], times: [] };
                }

                ListCapture[basepoint].teams.push(team);
                ListCapture[basepoint].times.push(startTime);
            }

            if (EndFinalTime) {
                let endTime = new Date(`1970-01-01T${EndFinalTime[1]}Z`);
                if (!isNaN(endTime)) {
                    FinalEnd = endTime;
                }
            }
        });

        function formatTime(milliseconds) {
            let totalSeconds = Math.floor(milliseconds / 1000);
            let hours = Math.floor(totalSeconds / 3600);
            let minutes = Math.floor((totalSeconds % 3600) / 60);

            return `${hours} hour(s) and ${minutes} min(s)`;
        }

        let now = new Date();
        let day = String(now.getDate()).padStart(2, '0');
        let month = String(now.getMonth() + 1).padStart(2, '0'); // January is 0!
        let formattedDate = `${day}. ${month}.`;

        let output = `# Zabírání z ${formattedDate}\n\n`;

        for (let basepoint in ListCapture) {
            let teams = ListCapture[basepoint].teams;
            let times = ListCapture[basepoint].times;

            // Create an array of indices
            let indices = Array.from({ length: times.length }, (_, i) => i);

            // Sort the indices array by the corresponding times
            indices.sort((a, b) => times[a] - times[b]);

            // Create new arrays for teams and times
            let sortedTeams = [];
            let sortedTimes = [];

            // Use the sorted indices to populate the new arrays
            for (let i of indices) {
                sortedTeams.push(teams[i]);
                sortedTimes.push(times[i]);
            }

            // Replace the original arrays with the sorted arrays
            ListCapture[basepoint].teams = sortedTeams;
            ListCapture[basepoint].times = sortedTimes;

            let ListTeam= {};

            for (let j = 0; j < ListCapture[basepoint].teams.length; j++) {
                if (!ListTeam[ListCapture[basepoint].teams[j]]) {
                    ListTeam[ListCapture[basepoint].teams[j]] = {"TeamName": ListCapture[basepoint].teams[j], time: 0};
                }
                if(j + 1 < ListCapture[basepoint].times.length) {
                    let time = ListCapture[basepoint].times[j].getTime();
                    let timeEnd = ListCapture[basepoint].times[j + 1].getTime();
                    let diff = timeEnd - time;
                    ListTeam[ListCapture[basepoint].teams[j]].time += diff;
                }
                else {
                    let time = ListCapture[basepoint].times[j].getTime();
                    let timeEnd = FinalEnd.getTime();
                    let diff = timeEnd - time;
                    ListTeam[ListCapture[basepoint].teams[j]].time += diff;
                }
            }

            // Append the basepoint to the output string
            output += `**${basepoint}:**\n`;

            // Iterate over all teams and append each team along with their time
            for (let team in ListTeam) {
                let time = formatTime(ListTeam[team].time);
                output += `  - ${team}: ${time}\n`;
            }
        }
        let timeString = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false}).format(FinalEnd);
        output += `*Konec zabírání: ${timeString}*`;

        output += "\n*Obsazuje se 45 minut po začátku SSU*";

        // Send the output string as a single message
        interaction.reply(output);
    }
};
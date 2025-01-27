import type { Database } from 'better-sqlite3';
import { createPublicClient, http, getContract, type Abi, type Address } from 'viem';
import { gnosis } from 'viem/chains';

import NameRegistryAbi from '../../abis/NameRegistryAbi.json';
import config from '../../config/config';

const nameRegistryAbi = NameRegistryAbi as Abi;

export default {
    up: async (db: Database) => {
        // add registeredName column
        db.exec(`
            ALTER TABLE profiles
            ADD COLUMN registeredName TEXT;
        `);

        const client = createPublicClient({
            chain: gnosis,
            transport: http(config.rpcEndpoint),
        });

        const nameRegistryContract = getContract({
            address: config.nameRegistryContract as Address,
            abi: nameRegistryAbi,
            client,
        });

        // create prepared statements
        const selectStmt = db.prepare('SELECT address FROM profiles');
        const updateStmt = db.prepare(`
            UPDATE profiles
            SET registeredName = ?
            WHERE address = ?;
        `);

        type ProfileRecord = {
            address: string;
        };

        // get all profiles
        const profiles = selectStmt.all() as ProfileRecord[];
        const batchSize = 100;
        let processed = 0;

        // process profiles in batches
        while (processed < profiles.length) {
            const batch = profiles.slice(processed, processed + batchSize);
            
            // fetch registered names for batch
            const names = await Promise.all(
                batch.map(async (profile) => {
                    try {
                        const result = await nameRegistryContract.read.name([profile.address]);
                        return result as string;
                    } catch (error) {
                        console.error(`Failed to fetch name for ${profile.address}:`, error);
                        return null;
                    }
                })
            );

            // update profiles with registered names
            batch.forEach((profile, index) => {
                updateStmt.run(names[index], profile.address);
            });

            processed += batchSize;
            console.log(`Processed ${processed} of ${profiles.length} profiles...`);
            
            // add delay between batches
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    },
    down: (db: Database) => {
        db.exec(`
            ALTER TABLE profiles
            DROP COLUMN registeredName;
        `);
    }
};

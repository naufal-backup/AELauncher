'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const EventEmitter = require('events');

// Mocking parts of electron/main.js logic for testing downloadPart behavior
// We'll reimplement a simplified version of the logic to test the signal handling

async function mockedDownloadPart({ signal, onProgress }) {
  const maxRetries = 1;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    try {
      const responseStream = new EventEmitter();
      responseStream.destroy = jest.fn();

      // Simulate network delay and data
      const downloadPromise = new Promise((resolve, reject) => {
        const onAbort = () => {
          responseStream.destroy();
          reject(new Error('Aborted'));
        };

        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
        }

        // Simulate data coming in
        let chunks = 0;
        const interval = setInterval(() => {
          if (signal?.aborted) {
            clearInterval(interval);
            return;
          }
          chunks++;
          responseStream.emit('data', Buffer.alloc(100));
          onProgress(chunks * 100, 100);
          
          if (chunks >= 5) {
            clearInterval(interval);
            responseStream.emit('end');
            resolve({ downloadedBytes: chunks * 100 });
          }
        }, 10);
      });

      return await downloadPromise;
    } catch (error) {
      if (error.message === 'Aborted' || signal?.aborted) {
        throw new Error('Aborted');
      }
      retryCount++;
    }
  }
}

describe('Download Pause Logic', () => {
  test('should stop when AbortController signals abort', async () => {
    const controller = new AbortController();
    const onProgress = jest.fn();

    // Start download
    const downloadPromise = mockedDownloadPart({ 
      signal: controller.signal, 
      onProgress 
    });

    // Pause after 20ms
    setTimeout(() => {
      controller.abort();
    }, 25);

    await expect(downloadPromise).rejects.toThrow('Aborted');
    
    // Check that progress didn't reach 500 (which would mean it finished)
    const calls = onProgress.mock.calls;
    const lastProgress = calls.length > 0 ? calls[calls.length - 1][0] : 0;
    expect(lastProgress).toBeLessThan(500);
  });

  test('should throw Aborted immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const onProgress = jest.fn();

    await expect(mockedDownloadPart({ 
      signal: controller.signal, 
      onProgress 
    })).rejects.toThrow('Aborted');
    
    expect(onProgress).not.toHaveBeenCalled();
  });
});

import {
  describe, expect, it, vi
} from 'vitest';
import { ApiRequestError } from '../infrastructure';
import {
  createCustomReport,
  deleteCustomReport,
  fetchCustomReports,
  InvalidCustomReportResponseError,
  updateCustomReport,
} from './customReports';
import {
  buildCustomReport, buildCustomReportInput
} from './customReports-fixtures';
import {
  mockApiDelete, mockApiGet, mockApiPost, mockApiPut
} from './clientMock-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

const WRITE_OPTIONS = { allowStructured4xx: true };

describe('custom reports API', () => {
  describe('fetchCustomReports', () => {
    it('returns the reports of a valid list with every block field kept', async () => {
      const reports = [buildCustomReport(), buildCustomReport({
        id: 'report-launch',
        blocks: [{
          type: 'future_block',
          settings: { compact: true },
        }],
      })];
      mockApiGet.mockResolvedValue({ reports });

      await expect(fetchCustomReports()).resolves.toStrictEqual(reports);
    });

    it('requests the list with the caller\u2019s abort signal', async () => {
      const controller = new AbortController();
      mockApiGet.mockResolvedValue({ reports: [] });

      await fetchCustomReports(controller.signal);

      expect(mockApiGet).toHaveBeenCalledWith('/custom-reports', { signal: controller.signal });
    });

    it('throws InvalidCustomReportResponseError when a report is malformed', async () => {
      mockApiGet.mockResolvedValue({
        reports: [{
          ...buildCustomReport(),
          days: 60,
        }],
      });

      await expect(fetchCustomReports()).rejects.toThrow(InvalidCustomReportResponseError);
      await expect(fetchCustomReports()).rejects.toThrow('Custom report API returned an invalid list');
    });
  });

  describe('createCustomReport', () => {
    it('posts the title, blocks and days', async () => {
      const input = buildCustomReportInput();
      mockApiPost.mockResolvedValue({ report: buildCustomReport() });

      await createCustomReport(input);

      expect(mockApiPost).toHaveBeenCalledWith('/custom-reports', input, WRITE_OPTIONS);
    });

    it('returns the created report', async () => {
      const created = buildCustomReport({ id: 'report-new' });
      mockApiPost.mockResolvedValue({ report: created });

      await expect(createCustomReport(buildCustomReportInput())).resolves.toStrictEqual(created);
    });

    it('sends only the title, blocks and days when given a whole report', async () => {
      const existing = buildCustomReport();
      mockApiPost.mockResolvedValue({ report: existing });

      await createCustomReport(existing);

      expect(mockApiPost).toHaveBeenCalledWith('/custom-reports', {
        title: existing.title,
        blocks: existing.blocks,
        days: existing.days,
      }, WRITE_OPTIONS);
    });

    it('throws InvalidCustomReportResponseError when the response holds no report', async () => {
      mockApiPost.mockResolvedValue(buildCustomReport());

      await expect(createCustomReport(buildCustomReportInput())).rejects.toThrow(InvalidCustomReportResponseError);
      await expect(createCustomReport(buildCustomReportInput())).rejects.toThrow('Custom report API returned an invalid report');
    });

    it('passes on the limit error with the field the server named', async () => {
      mockApiPost.mockRejectedValue(new ApiRequestError('limit_reached', {
        statusCode: 409,
        field: 'reports',
      }));

      await expect(createCustomReport(buildCustomReportInput())).rejects.toMatchObject({
        statusCode: 409,
        field: 'reports',
      });
    });
  });

  describe('updateCustomReport', () => {
    it('puts the input to the encoded report id', async () => {
      const input = buildCustomReportInput({ title: 'Renamed' });
      mockApiPut.mockResolvedValue({ report: buildCustomReport({ title: 'Renamed' }) });

      await updateCustomReport('report/with space', input);

      expect(mockApiPut).toHaveBeenCalledWith('/custom-reports/report%2Fwith%20space', input, WRITE_OPTIONS);
    });

    it('returns the updated report', async () => {
      const updated = buildCustomReport({ days: 180 });
      mockApiPut.mockResolvedValue({ report: updated });

      await expect(updateCustomReport('report-quarterly', buildCustomReportInput({ days: 180 }))).resolves.toStrictEqual(updated);
    });
  });

  describe('deleteCustomReport', () => {
    it('deletes by encoded id', async () => {
      mockApiDelete.mockResolvedValue({ deleted: 'report/with space' });

      await deleteCustomReport('report/with space');

      expect(mockApiDelete).toHaveBeenCalledWith('/custom-reports/report%2Fwith%20space', WRITE_OPTIONS);
    });
  });
});

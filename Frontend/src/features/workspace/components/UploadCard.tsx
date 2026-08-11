import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  Link,
  Stack,
  Typography
} from "@mui/material";

import TextSnippetOutlinedIcon from "@mui/icons-material/TextSnippetOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";

import { useUploadStore } from "@/store/uploadStore";
import type { InspectionType } from "@/store/uploadStore";

import {
  TEXT_INSPECTION_FILE_TYPES,
  validateFile
} from "@/shared/utils/fileValidation";

type UploadCardProps = {
  title: string;
  inspectionType: InspectionType;
};

export default function UploadCard({
  title,
  inspectionType
}: UploadCardProps) {

  const navigate = useNavigate();

  const {
    setMasterFile,
    setSampleFile,
    setInspectionType
  } = useUploadStore();

  /* -------------------------------------------------------------------------- */
  /*                                  States                                    */
  /* -------------------------------------------------------------------------- */

  const [master, setMaster] = useState<File | null>(null);

  const [sample, setSample] = useState<File | null>(null);

  const [masterError, setMasterError] = useState("");

  const [sampleError, setSampleError] = useState("");

  const [removeHeaders, setRemoveHeaders] = useState(true);

  /* -------------------------------------------------------------------------- */
  /*                               Hidden Inputs                                */
  /* -------------------------------------------------------------------------- */

  const masterInputRef = useRef<HTMLInputElement>(null);

  const sampleInputRef = useRef<HTMLInputElement>(null);

  /* -------------------------------------------------------------------------- */
  /*                              Browse Handlers                               */
  /* -------------------------------------------------------------------------- */

  const openMasterBrowser = () => {
    masterInputRef.current?.click();
  };

  const openSampleBrowser = () => {
    sampleInputRef.current?.click();
  };

  /* -------------------------------------------------------------------------- */
  /*                            Master File Handler                             */
  /* -------------------------------------------------------------------------- */

  const handleMasterFile = (file: File) => {

    const result = validateFile(
      file,
      TEXT_INSPECTION_FILE_TYPES
    );

    if (!result.isValid) {

      setMaster(null);

      setMasterError(result.error);

      return;
    }

    setMaster(file);

    setMasterError("");
  };

  /* -------------------------------------------------------------------------- */
  /*                            Sample File Handler                             */
  /* -------------------------------------------------------------------------- */

  const handleSampleFile = (file: File) => {

    const result = validateFile(
      file,
      TEXT_INSPECTION_FILE_TYPES
    );

    if (!result.isValid) {

      setSample(null);

      setSampleError(result.error);

      return;
    }

    setSample(file);

    setSampleError("");
  };

  /* -------------------------------------------------------------------------- */
  /*                              Input Handlers                                */
  /* -------------------------------------------------------------------------- */

  const onMasterInputChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {

    const file = event.target.files?.[0];

    if (!file) return;

    handleMasterFile(file);
  };

  const onSampleInputChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {

    const file = event.target.files?.[0];

    if (!file) return;

    handleSampleFile(file);
  };

  /* -------------------------------------------------------------------------- */
  /*                               Remove Files                                 */
  /* -------------------------------------------------------------------------- */

  const removeMaster = () => {

    setMaster(null);

    setMasterError("");

    if (masterInputRef.current) {

      masterInputRef.current.value = "";
    }
  };

  const removeSample = () => {

    setSample(null);

    setSampleError("");

    if (sampleInputRef.current) {

      sampleInputRef.current.value = "";
    }
  };

  /* -------------------------------------------------------------------------- */
  /*                            Upload Button State                             */
  /* -------------------------------------------------------------------------- */

  const isUploadEnabled =
    master !== null &&
    sample !== null &&
    masterError === "" &&
    sampleError === "";

  /* -------------------------------------------------------------------------- */
  /*                           Upload Button Handler                            */
  /* -------------------------------------------------------------------------- */

  const handleUpload = () => {
    if (!isUploadEnabled) return;

    setMasterFile(master);
    setSampleFile(sample);
    setInspectionType(inspectionType);

    navigate(`/workspace/${inspectionType}`);
  };

  return (
  <Card
    elevation={2}
    sx={{
      width: 520,
      borderRadius: 2,
      overflow: "hidden"
    }}
  >
    {/* ================= Header ================= */}

    <Box
      sx={{
        height: 62,
        bgcolor: "#2A276E",
        display: "flex",
        alignItems: "center",
        px: 3,
        color: "#fff"
      }}
    >
      <TextSnippetOutlinedIcon sx={{ mr: 2 }} />

      <Typography
        variant="h5"
       sx={{ fontWeight: 500 }}
      >
        {title}
      </Typography>
    </Box>

    <CardContent
      sx={{
        p: 3
      }}
    >
      {/* ===================================================== */}
      {/* Hidden Master Input                                  */}
      {/* ===================================================== */}

      <input
        hidden
        ref={masterInputRef}
        type="file"
        accept={TEXT_INSPECTION_FILE_TYPES.join(",")}
        onChange={onMasterInputChange}
      />

      {/* ===================================================== */}
      {/* Master Upload Box                                     */}
      {/* ===================================================== */}

      <Box
        onClick={openMasterBrowser}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();

          const file = event.dataTransfer.files[0];

          if (!file) return;

          handleMasterFile(file);
        }}
        sx={{
          height: 170,

          border:
            masterError !== ""
              ? "2px dashed #d32f2f"
              : master
              ? "2px dashed #2A276E"
              : "2px dashed #BDBDBD",

          borderRadius: 2,

          cursor: "pointer",

          display: "flex",

          justifyContent: "center",

          alignItems: "center",

          transition: ".25s",

          mb: 3,

          "&:hover": {
            bgcolor: "#F7F7FC",

            borderColor: "#2A276E"
          }
        }}
      >
        {!master ? (
          <Stack
            spacing={1.5}
           sx={{ alignItems: "center" }}
          >
            <CloudUploadOutlinedIcon
              sx={{
                fontSize: 55,

                color: "#2A276E"
              }}
            />

            <Typography
             sx={{ fontWeight: 500 }}
            >
              Drop Master File
            </Typography>

            <Typography
              variant="body2"
            >
              or{" "}
              <Link
                component="button"
                underline="hover"
                color="#2A276E"
                onClick={(e) => {
                  e.stopPropagation();
                  openMasterBrowser();
                }}
              >
                Browse
              </Link>
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
            >
              PDF • DOC • DOCX • AI • TXT • RTF • XLS • XLSX • XML
            </Typography>
          </Stack>
        ) : (
          <Stack
            spacing={2}
            sx={{ alignItems: "center" }}
          >
            <DescriptionOutlinedIcon
              sx={{
                fontSize: 52,

                color: "#2A276E"
              }}
            />

            <Typography
              variant="body1"
              noWrap
              sx={{
                fontWeight: 500,
                textAlign: "center",
                maxWidth: 420,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {master.name}
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
            >
              {(master.size / (1024 * 1024)).toFixed(2)} MB
            </Typography>

            <Button
              color="error"
              startIcon={<DeleteOutlineOutlinedIcon />}
              onClick={(event) => {
                event.stopPropagation();

                removeMaster();
              }}
            >
              Remove
            </Button>
          </Stack>
        )}
      </Box>

      {/* ===================================================== */}
      {/* Master Error                                          */}
      {/* ===================================================== */}

      {masterError && (
        <Typography
          color="error"
          sx={{
            mb: 3
          }}
        >
          {masterError}
        </Typography>
      )}

      {/* ---------------- PART 3 STARTS HERE ---------------- */}
            {/* ===================================================== */}
      {/* Hidden Sample Input                                   */}
      {/* ===================================================== */}

      <input
        hidden
        ref={sampleInputRef}
        type="file"
        accept={TEXT_INSPECTION_FILE_TYPES.join(",")}
        onChange={onSampleInputChange}
      />

      {/* ===================================================== */}
      {/* Sample Upload Box                                     */}
      {/* ===================================================== */}

      <Box
        onClick={openSampleBrowser}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();

          const file = event.dataTransfer.files[0];

          if (!file) return;

          handleSampleFile(file);
        }}
        sx={{
          height: 170,

          border:
            sampleError !== ""
              ? "2px dashed #d32f2f"
              : sample
              ? "2px dashed #2A276E"
              : "2px dashed #BDBDBD",

          borderRadius: 2,

          cursor: "pointer",

          display: "flex",

          justifyContent: "center",

          alignItems: "center",

          transition: ".25s",

          mb: 3,

          "&:hover": {
            bgcolor: "#F7F7FC",

            borderColor: "#2A276E"
          }
        }}
      >
        {!sample ? (
          <Stack
            spacing={1.5}
            sx={{ alignItems: "center" }}
          >
            <CloudUploadOutlinedIcon
              sx={{
                fontSize: 55,
                color: "#2A276E"
              }}
            />

            <Typography 
             sx={{ fontWeight: 500 }}
            >
              Drop Sample File
            </Typography>

            <Typography variant="body2">
              or{" "}
              <Link
                component="button"
                underline="hover"
                color="#2A276E"
                onClick={(event) => {
                  event.stopPropagation();
                  openSampleBrowser();
                }}
              >
                Browse
              </Link>
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
            >
              PDF • DOC • DOCX • AI • TXT • RTF • XLS • XLSX • XML
            </Typography>
          </Stack>
        ) : (
          <Stack
            spacing={2}
            sx={{ alignItems: "center" }}
          >
            <DescriptionOutlinedIcon
              sx={{
                fontSize: 52,
                color: "#2A276E"
              }}
            />

            <Typography
              variant="body1"
              noWrap
              sx={{
                fontWeight: 600,
                textAlign: "center",
                maxWidth: 420,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {sample.name}
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
            >
              {(sample.size / (1024 * 1024)).toFixed(2)} MB
            </Typography>

            <Button
              color="error"
              startIcon={<DeleteOutlineOutlinedIcon />}
              onClick={(event) => {
                event.stopPropagation();

                removeSample();
              }}
            >
              Remove
            </Button>
          </Stack>
        )}
      </Box>

      {/* ===================================================== */}
      {/* Sample Error                                          */}
      {/* ===================================================== */}

      {sampleError && (
        <Typography
          color="error"
          sx={{
            mb: 3
          }}
        >
          {sampleError}
        </Typography>
      )}

      {/* ---------------- PART 4 STARTS HERE ---------------- */}
            {/* ===================================================== */}
      {/* Advanced Options                                      */}
      {/* ===================================================== */}

      <Typography
        sx={{
          mt: 2,
          mb: 1,
          fontWeight: 700
        }}
      >
        Advanced Options
      </Typography>

      <FormControlLabel
        control={
          <Checkbox
            checked={removeHeaders}
            onChange={(event) =>
              setRemoveHeaders(event.target.checked)
            }
          />
        }
        label="Remove Headers / Footers (Word files only)"
      />

      {/* ===================================================== */}
      {/* Upload Button                                         */}
      {/* ===================================================== */}

      <Button
        fullWidth
        variant="contained"
        disabled={!isUploadEnabled}
        onClick={handleUpload}
        sx={{
          mt: 3,
          py: 1.5,
          fontWeight: 600,
          bgcolor: "#2A276E",

          "&:hover": {
            bgcolor: "#211F58"
          },

          "&.Mui-disabled": {
            bgcolor: "#D9D9D9",
            color: "#8A8A8A"
          }
        }}
      >
        Upload & Continue
      </Button>

      {/* ===================================================== */}
      {/* Upload Status                                         */}
      {/* ===================================================== */}

      {!isUploadEnabled && (
        <Typography
          color="error"
          sx={{
            mt: 2,
            fontSize: 13,
            alignItems: "center"
          }}
        >
          Please upload one valid Master file and one valid Sample file.
        </Typography>
      )}

      {isUploadEnabled && (
        <Typography
  sx={{
    textAlign: "center",
    color: "success.main",
    mt: 2,
    fontWeight: 600,
  }}
>
          ✓ Files validated successfully. Ready to continue.
        </Typography>
      )}

      {/* ===================================================== */}
      {/* Description                                           */}
      {/* ===================================================== */}

      <Typography
        color="text.secondary"
        sx={{
          mt: 3,
          textAlign: "center",
          fontSize: 14
        }}
      >
        Compare text content in artwork or documents.
      </Typography>

      <Typography
        color="text.secondary"
        sx={{
          textAlign: "center",
          fontSize: 14
        }}
      >
        Supports files with live, selectable text.
      </Typography>

      {/* ===================================================== */}
      {/* Supported Formats                                     */}
      {/* ===================================================== */}

      <Box
        sx={{
          mt: 4,
          p: 2,
          borderRadius: 2,
          bgcolor: "#F7F7FC"
        }}
      >
        <Typography
  gutterBottom
  sx={{
    fontWeight: 700,
  }}
>
          Supported File Types
        </Typography>

        <Typography
          variant="body2"
          color="text.secondary"
        >
          PDF, DOC, DOCX, TXT, RTF, XML, XLS, XLSX, AI
        </Typography>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            mt: 1
          }}
        >
          Maximum File Size: 10 GB
        </Typography>
      </Box>

    </CardContent>
  </Card>
);
}
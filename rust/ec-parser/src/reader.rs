use std::fmt;

pub struct BinaryReader<'a> {
    data: &'a [u8],
    offset: usize,
}

#[derive(Debug)]
pub struct ReaderError {
    pub message: String,
}

impl fmt::Display for ReaderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ReaderError: {}", self.message)
    }
}

impl<'a> BinaryReader<'a> {
    #[inline]
    pub fn new(data: &'a [u8]) -> Self {
        BinaryReader { data, offset: 0 }
    }

    #[inline]
    fn check_remaining(&self, n: usize) -> Result<(), ReaderError> {
        if self.offset + n > self.data.len() {
            return Err(ReaderError {
                message: format!(
                    "offset {} + {} exceeds data length {}",
                    self.offset,
                    n,
                    self.data.len()
                ),
            });
        }
        Ok(())
    }

    /// Read a 4-byte little-endian i32
    #[inline]
    pub fn read_int(&mut self) -> Result<i32, ReaderError> {
        self.check_remaining(4)?;
        // SAFETY: check_remaining guarantees 4 bytes available
        let val = i32::from_le_bytes(unsafe {
            *self.data.as_ptr().add(self.offset).cast()
        });
        self.offset += 4;
        Ok(val)
    }

    /// Read a 2-byte little-endian i16
    #[inline]
    pub fn read_short(&mut self) -> Result<i16, ReaderError> {
        self.check_remaining(2)?;
        let val = i16::from_le_bytes(unsafe {
            *self.data.as_ptr().add(self.offset).cast()
        });
        self.offset += 2;
        Ok(val)
    }

    /// Read 1 byte
    #[inline]
    pub fn read_byte(&mut self) -> Result<u8, ReaderError> {
        self.check_remaining(1)?;
        let val = self.data[self.offset];
        self.offset += 1;
        Ok(val)
    }

    /// Read an 8-byte little-endian f64
    #[inline]
    pub fn read_double(&mut self) -> Result<f64, ReaderError> {
        self.check_remaining(8)?;
        let val = f64::from_le_bytes(unsafe {
            *self.data.as_ptr().add(self.offset).cast()
        });
        self.offset += 8;
        Ok(val)
    }

    /// Read an 8-byte little-endian f64 as date
    #[inline]
    pub fn read_date(&mut self) -> Result<f64, ReaderError> {
        self.read_double()
    }

    /// Read a boolean (1 byte)
    #[inline]
    pub fn read_boolean(&mut self) -> Result<bool, ReaderError> {
        let val = self.read_byte()?;
        Ok(val != 0)
    }

    /// Read a specified number of bytes
    #[inline]
    pub fn read_bytes(&mut self, len: usize) -> Result<&'a [u8], ReaderError> {
        self.check_remaining(len)?;
        let result = &self.data[self.offset..self.offset + len];
        self.offset += len;
        Ok(result)
    }

    /// Read a string: 4-byte length prefix + that many bytes, decoded as GBK
    pub fn read_string(&mut self) -> Result<String, ReaderError> {
        let len = self.read_int()?;
        if len < 0 {
            return Err(ReaderError {
                message: format!("read_string: negative length {}", len),
            });
        }
        let len = len as usize;
        self.check_remaining(len)?;
        let bytes = &self.data[self.offset..self.offset + len];
        self.offset += len;
        let (cow, _, had_errors) = encoding_rs::GBK.decode(bytes);
        if had_errors {
            Ok(String::from_utf8_lossy(bytes).into_owned())
        } else {
            Ok(cow.into_owned())
        }
    }

    /// Read a null-terminated ANSI (GBK) string
    pub fn read_normal_string(&mut self) -> Result<String, ReaderError> {
        let start = self.offset;
        // Use memchr-style search for null byte
        let remaining = &self.data[start..];
        let null_pos = match remaining.iter().position(|&b| b == 0) {
            Some(p) => p,
            None => {
                return Err(ReaderError {
                    message: "read_normal_string: null terminator not found".to_string(),
                });
            }
        };
        let bytes = &remaining[..null_pos];
        self.offset = start + null_pos + 1;
        let (cow, _, _) = encoding_rs::GBK.decode(bytes);
        Ok(cow.into_owned())
    }

    /// Skip N bytes forward
    #[inline]
    pub fn skip(&mut self, n: usize) -> Result<(), ReaderError> {
        self.check_remaining(n)?;
        self.offset += n;
        Ok(())
    }

    /// Move to absolute offset
    #[inline]
    pub fn move_to(&mut self, offset: usize) -> Result<(), ReaderError> {
        if offset > self.data.len() {
            return Err(ReaderError {
                message: format!("move_to: offset {} exceeds data length {}", offset, self.data.len()),
            });
        }
        self.offset = offset;
        Ok(())
    }

    /// Get remaining available bytes
    #[inline]
    pub fn available(&self) -> usize {
        self.data.len().saturating_sub(self.offset)
    }

    /// Get current offset
    #[inline]
    pub fn get_offset(&self) -> usize {
        self.offset
    }

    /// Create a new reader at the same position sharing the same data
    #[inline]
    pub fn clone_at(&self) -> BinaryReader<'a> {
        BinaryReader {
            data: self.data,
            offset: self.offset,
        }
    }

    /// Get a reference to the underlying data slice
    #[inline]
    pub fn data(&self) -> &'a [u8] {
        self.data
    }

    /// Read a 4-byte little-endian u32
    #[inline]
    pub fn read_uint(&mut self) -> Result<u32, ReaderError> {
        self.check_remaining(4)?;
        let val = u32::from_le_bytes(unsafe {
            *self.data.as_ptr().add(self.offset).cast()
        });
        self.offset += 4;
        Ok(val)
    }
}
